import { recordRevision } from 'src/storage/postgres/recordRevision';
import { commandTransaction } from 'src/storage/postgres/commandTransaction';
import { loadFetchedRecords } from './loadFetchedRecords';
import { shadowDifferences } from './shadowDifference';
import { asyncEngine, tools } from 'tods-competition-factory';
import asyncGlobalState from '../engines/asyncGlobalState';
import { Logger } from '@nestjs/common';

import type { ITournamentStorage, PhysicalFootprintReader } from 'src/storage/interfaces/tournament-storage.interface';
import type { PoolClient } from 'pg';

// For its module-scope setup: the governors' methods and the async state provider every engine here relies on.
import '../engines/getMutationEngine';

/**
 * SHARD SHADOW — does a mutation give the same draw when the engine holds only the part of the record its footprint
 * names? The check that has to pass, on real traffic, before any tournament is ever read from shards (Mentat
 * planning/CFS_RECORD_SHARDING_EXPLORATION.md §7). Report only, off the request path, off by default.
 *
 *   SHARD_SHADOW_SAMPLE_RATE  fraction of eligible mutations to check, 0 (default, off) to 1.
 *
 * Eligible: one tournament, and a footprint (factory `tools.getMutationFootprint`) that does not need the whole
 * record. INSIDE the lock, before the queue runs, a sampled mutation's partial record is built from the record as
 * fetched. With CFS_PHYSICAL_FOOTPRINT_READS=true a durable command can take that partial from its physical shards
 * if their parent revision matches the exact full preimage. Otherwise the existing in-memory projection is used.
 * After the save, the draws the footprint names are taken from the saved record by reference: the mutation is finished with them, and nothing mutates them afterwards (see
 * `snapshotTouchedDraws`). After the lock and the response, on a later turn of the event loop, the same methods run on
 * the partial record in an engine of their own (fresh instance state, no subscriptions: nothing it does reaches this
 * request, the projection, the cache or the audit), marked as partial (`loadedFootprint`) so a method that reaches
 * outside its declared footprint is refused rather than answering from missing data.
 *
 * Outcomes, logged and counted (`shardShadowStats`; `physicalOutcomes` counts completed physical replays only):
 *   match      every named draw is identical to the saved one, timestamps aside;
 *   mismatch   a draw differs (ERROR: the footprint, or partial loading, is wrong for these methods);
 *   refused    the partial run was refused (ERROR when FOOTPRINT_NOT_LOADED: an under-declared footprint);
 *   error      the partial run threw.
 */

const CONTEXT = 'ShardShadow';

/** Fields that differ between two runs of the same mutation by construction. Same set as the benchmark's. */
const VOLATILE_KEYS = new Set(['updatedAt', 'createdAt', 'scoredTime', 'timeStamp']);

/** Each pending check holds a copy of part of a record; a burst sheds checks rather than memory. */
export const MAX_PENDING_SHADOWS = 50;

type Outcome = 'match' | 'mismatch' | 'refused' | 'error';

export interface ShadowPlan {
  tournamentId: string;
  footprint: any;
  methods: any[];
  partialRecord: any;
  physical: boolean;
  rollbackOnError?: boolean;
}

export interface ShadowBatch extends ShadowPlan {
  /** The saved record's drawDefinitions the footprint names, by drawId. */
  savedDraws: Record<string, any>;
}

const stats = {
  physicalSelected: 0,
  physicalStale: 0,
  physicalFallback: 0,
  physicalReadError: 0,
  sampled: 0,
  wholeRecord: 0,
  shed: 0,
  match: 0,
  mismatch: 0,
  refused: 0,
  error: 0,
};
const physicalOutcomes: Record<Outcome, number> = { match: 0, mismatch: 0, refused: 0, error: 0 };
let pending = 0;

export function shardShadowStats() {
  return { ...stats, physicalOutcomes: { ...physicalOutcomes }, pending };
}

export function resetShardShadowStats() {
  for (const key of Object.keys(stats)) stats[key] = 0;
  for (const key of Object.keys(physicalOutcomes)) physicalOutcomes[key] = 0;
  pending = 0;
}

export function shardShadowSampleRate(): number {
  const rate = Number(process.env.SHARD_SHADOW_SAMPLE_RATE);
  return Number.isFinite(rate) && rate > 0 ? Math.min(rate, 1) : 0;
}

export function sampleShardShadow(tournamentIds: string[], methods: any[], random = Math.random): boolean {
  const rate = shardShadowSampleRate();
  return rate > 0 && tournamentIds.length === 1 && methods?.length > 0 && random() < rate;
}

interface ShadowTransaction {
  client: PoolClient;
  read: PhysicalFootprintReader;
}

export function physicalShadowTransaction(
  storage: Pick<ITournamentStorage, 'readerForTournament'>,
  tournamentId: string,
): ShadowTransaction | undefined {
  const client = commandTransaction.getStore()?.client;
  if (!client) return;
  const read = storage.readerForTournament?.(tournamentId);
  return read ? { client, read } : undefined;
}

type Footprint = ReturnType<typeof tools.getMutationFootprint>;

async function physicalPartial(transaction: ShadowTransaction, full: object, methods: any[], footprint: Footprint) {
  const expected = recordRevision(full);
  if (!expected) {
    stats.physicalFallback += 1;
    return;
  }
  const bindings = new Map<string, string>();
  for (const { params } of methods) {
    if (!params?.drawId || !params.eventId) continue;
    if (bindings.has(params.drawId) && bindings.get(params.drawId) !== params.eventId) {
      stats.physicalFallback += 1;
      return;
    }
    bindings.set(params.drawId, params.eventId);
  }

  // A failed optional SELECT would otherwise poison the authoritative command's transaction.
  const { client } = transaction;
  await client.query('SAVEPOINT physical_shard_shadow');
  try {
    const read = await transaction.read({
      footprint,
      drawEventIds: Object.fromEntries(bindings),
    });
    if (read.kind === 'fallback') {
      stats.physicalFallback += 1;
      return;
    }
    if (recordRevision(read.tournamentRecord) !== expected) {
      stats.physicalStale += 1;
      return;
    }
    stats.physicalSelected += 1;
    return { partialRecord: read.tournamentRecord, footprint: read.loadedFootprint };
  } catch {
    await client.query('ROLLBACK TO SAVEPOINT physical_shard_shadow');
    stats.physicalReadError += 1;
    return;
  } finally {
    await client.query('RELEASE SAVEPOINT physical_shard_shadow');
  }
}

type OutcomePipeline = Parameters<typeof tools.getMutationFootprint>[0]['outcomePipeline'];

/**
 * Inside the lock, BEFORE the queue runs (it mutates the fetched record in place). Returns undefined when this
 * mutation is not checked. `methods` must be final: after `resolveMatchUpReferences` has filled in drawIds.
 */
export async function planShardShadow({
  methods,
  tournamentIds,
  tournamentRecords,
  outcomePipeline,
  transaction,
  rollbackOnError,
}: {
  methods: any[];
  tournamentIds: string[];
  tournamentRecords: Record<string, any>;
  outcomePipeline?: OutcomePipeline;
  transaction?: ShadowTransaction;
  rollbackOnError?: boolean;
}): Promise<ShadowPlan | undefined> {
  const [tournamentId] = tournamentIds;
  const tournamentRecord = tournamentRecords?.[tournamentId];
  if (!tournamentRecord) return undefined;

  try {
    const footprint = tools.getMutationFootprint({ methods, outcomePipeline });
    if (footprint?.tournament) {
      stats.wholeRecord += 1;
      return undefined;
    }
    stats.sampled += 1;
    const physical = transaction && (await physicalPartial(transaction, tournamentRecord, methods, footprint));
    return {
      tournamentId,
      methods: structuredClone(methods),
      rollbackOnError,
      physical: !!physical,
      ...(physical ?? { footprint, partialRecord: tools.reduceRecordToFootprint({ tournamentRecord, footprint }) }),
    };
  } catch (err: any) {
    Logger.error(`shadow plan failed for ${tournamentId}: ${err?.message ?? err}`, CONTEXT);
    return undefined;
  }
}

/** After the save commits: the saved draws the footprint names, by reference. */
export function captureShardShadow(plan: ShadowPlan | undefined, savedRecords: Record<string, any>) {
  if (!plan) return undefined;
  const savedRecord = savedRecords?.[plan.tournamentId];
  if (!savedRecord) return undefined;
  const savedDraws: Record<string, any> = {};
  for (const event of plan.partialRecord.events ?? []) {
    for (const { drawId } of event.drawDefinitions ?? []) {
      const saved = savedRecord.events
        ?.find(({ eventId }: any) => eventId === event.eventId)
        ?.drawDefinitions?.find((drawDefinition: any) => drawDefinition.drawId === drawId);
      savedDraws[drawId] = saved;
    }
  }
  return { ...plan, savedDraws } as ShadowBatch;
}

const canonical = (value: any) =>
  JSON.stringify(value, (key, v) => (VOLATILE_KEYS.has(key) ? undefined : v)) ?? 'undefined';

export async function runShardShadow(batch: ShadowBatch): Promise<Outcome> {
  const { tournamentId, footprint, methods, partialRecord, savedDraws } = batch;
  const names = methods.map(({ method }: any) => method).join(', ');
  try {
    return await asyncGlobalState.runWithInstanceState(async () => {
      const engine: any = asyncEngine();
      // DECISION (P66): use the live mutation loader on the footprint's private clone. The factory's
      // default copy drops JSON nulls; passing false would change the process-wide copy setting.
      const loaded = loadFetchedRecords({ [tournamentId]: partialRecord });
      if (loaded.error) {
        Logger.error(`error ${tournamentId} [${names}]: invalid partial record`, CONTEXT);
        return 'error';
      }
      if (typeof engine.loadedFootprint === 'function') engine.loadedFootprint(footprint);
      const result: any = await engine.executionQueue(methods, batch.rollbackOnError);
      if (!result?.success) {
        const code = result?.error?.code ?? result?.error?.message ?? 'unknown';
        Logger.error(`refused ${tournamentId} [${names}]: ${code}`, CONTEXT);
        return 'refused';
      }
      // read from this run's own instance state: the queue may have replaced the object it was given
      const shadowRecord: any = asyncGlobalState.getTournamentRecords()?.[tournamentId];
      let mismatch = false;
      const paths: string[] = [];
      const draws = shadowRecord?.events?.flatMap(({ drawDefinitions }: any) => drawDefinitions ?? []) ?? [];
      for (const [index, [drawId, draw]] of Object.entries(savedDraws).entries()) {
        if (paths.length >= 4) break;
        const saved = canonical(draw);
        const shadow = canonical(draws.find((candidate: any) => candidate.drawId === drawId));
        if (saved !== shadow) {
          mismatch = true;
          paths.push(...shadowDifferences(saved, shadow, `draw[${index}]`, 4 - paths.length));
        }
      }
      if (mismatch) {
        Logger.error(`mismatch ${tournamentId} [${names}]: ${paths.join('; ')}`, CONTEXT);
        return 'mismatch';
      }
      Logger.debug(`match ${tournamentId} [${names}]`, CONTEXT);
      return 'match';
    });
  } catch (err: any) {
    Logger.error(`error ${tournamentId} [${names}]: ${err?.message ?? err}`, CONTEXT);
    return 'error';
  }
}

/** After the lock and the response: one check, on a later turn of the event loop. Never throws. */
export function scheduleShardShadow(batch: ShadowBatch | undefined) {
  if (!batch) return;
  if (pending >= MAX_PENDING_SHADOWS) {
    stats.shed += 1;
    if (stats.shed === 1 || stats.shed % 100 === 0) {
      Logger.warn(`shed ${stats.shed} shadow check(s): ${MAX_PENDING_SHADOWS} already pending`, CONTEXT);
    }
    return;
  }
  pending += 1;
  setImmediate(() => {
    runShardShadow(batch)
      .then((outcome) => {
        stats[outcome] += 1;
        if (batch.physical) physicalOutcomes[outcome] += 1;
      })
      .finally(() => {
        pending -= 1;
      });
  });
}
