import { asyncEngine, tools } from 'tods-competition-factory';
import asyncGlobalState from '../engines/asyncGlobalState';
import { Logger } from '@nestjs/common';

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
 * fetched (`tools.reduceRecordToFootprint`, a copy). After the save, the draws the footprint names are taken from the
 * saved record by reference: the mutation is finished with them, and nothing mutates them afterwards (see
 * `snapshotTouchedDraws`). After the lock and the response, on a later turn of the event loop, the same methods run on
 * the partial record in an engine of their own (fresh instance state, no subscriptions: nothing it does reaches this
 * request, the projection, the cache or the audit), marked as partial (`loadedFootprint`) so a method that reaches
 * outside its declared footprint is refused rather than answering from missing data.
 *
 * Outcomes, logged and counted (`shardShadowStats`):
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
}

export interface ShadowBatch extends ShadowPlan {
  /** The saved record's drawDefinitions the footprint names, by drawId. */
  savedDraws: Record<string, any>;
}

const stats = { sampled: 0, wholeRecord: 0, shed: 0, match: 0, mismatch: 0, refused: 0, error: 0 };
let pending = 0;

export function shardShadowStats() {
  return { ...stats, pending };
}

export function resetShardShadowStats() {
  for (const key of Object.keys(stats)) stats[key] = 0;
  pending = 0;
}

export function shardShadowSampleRate(): number {
  const rate = Number(process.env.SHARD_SHADOW_SAMPLE_RATE);
  return Number.isFinite(rate) && rate > 0 ? Math.min(rate, 1) : 0;
}

type OutcomePipeline = Parameters<typeof tools.getMutationFootprint>[0]['outcomePipeline'];

/**
 * Inside the lock, BEFORE the queue runs (it mutates the fetched record in place). Returns undefined when this
 * mutation is not checked. `methods` must be final: after `resolveMatchUpReferences` has filled in drawIds.
 */
export function planShardShadow({
  methods,
  tournamentIds,
  tournamentRecords,
  outcomePipeline,
  random = Math.random,
}: {
  methods: any[];
  tournamentIds: string[];
  tournamentRecords: Record<string, any>;
  outcomePipeline?: OutcomePipeline;
  random?: () => number;
}): ShadowPlan | undefined {
  const rate = shardShadowSampleRate();
  if (!rate || tournamentIds.length !== 1 || !methods?.length) return undefined;
  if (random() >= rate) return undefined;

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
    return {
      tournamentId,
      footprint,
      methods: structuredClone(methods),
      partialRecord: tools.reduceRecordToFootprint({ tournamentRecord, footprint }),
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
      engine.setState(partialRecord);
      if (typeof engine.loadedFootprint === 'function') engine.loadedFootprint(footprint);
      const result: any = await engine.executionQueue(methods);
      if (!result?.success) {
        const code = result?.error?.code ?? result?.error?.message ?? 'unknown';
        Logger.error(`refused ${tournamentId} [${names}]: ${code}`, CONTEXT);
        return 'refused';
      }
      // read from this run's own instance state: the queue may have replaced the object it was given
      const shadowRecord: any = asyncGlobalState.getTournamentRecords()?.[tournamentId];
      const differing = Object.keys(savedDraws).filter((drawId) => {
        const shadowDraw = shadowRecord?.events
          ?.flatMap(({ drawDefinitions }: any) => drawDefinitions ?? [])
          .find((drawDefinition: any) => drawDefinition.drawId === drawId);
        return canonical(shadowDraw) !== canonical(savedDraws[drawId]);
      });
      if (differing.length) {
        Logger.error(`mismatch ${tournamentId} [${names}]: draw(s) ${differing.join(', ')}`, CONTEXT);
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
      })
      .finally(() => {
        pending -= 1;
      });
  });
}
