import { scheduleDrawIntegrityScan, snapshotTouchedDraws } from '../../helpers/executionQueueIntegrity';
import { documentRequestTournamentIds } from '../../projection/participantDocumentRequests';
import { HttpException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { runWithRequestContext } from 'src/modules/factory/engines/requestContext';
import { tournamentEngineAsync, factoryConstants } from 'tods-competition-factory';
import { buildProjectionDeltas } from '../../projection/buildProjectionDeltas';
import { afterCommandCommit } from 'src/storage/postgres/commandTransaction';
import asyncGlobalState from 'src/modules/factory/engines/asyncGlobalState';
import { runDurableCommand } from 'src/storage/postgres/commandReceipts';
import { getMutationEngine } from '../../engines/getMutationEngine';
import { withTournamentLock } from 'src/services/tournamentMutex';
import { createDeltaBuffer } from '../../projection/deltaBuffer';
import { drawIntegrityMode } from '../../helpers/drawIntegrity';
import { warmEventDataCache } from './warmEventDataCache';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';
import type { DrawIntegrityBatch } from '../../helpers/executionQueueIntegrity';
import type { AuditService } from 'src/modules/audit/audit.service';

export async function executionQueue(
  payload: any,
  services?: any,
  storage?: TournamentStorageService,
  auditService?: AuditService,
): Promise<any> {
  const { methods = [], rollbackOnError } = payload ?? {};
  const tournamentIds = payload?.tournamentIds || (payload?.tournamentId && [payload.tournamentId]) || [];

  if (!tournamentIds.length) {
    Logger.error('No tournamentRecord provided');
    return { error: 'No tournamentIds provided' };
  }

  if (!storage) return { error: 'Storage not provided' };

  try {
    const publicNotices: any[] = [];
    // `ged|<tid>|<eid>` keys evicted precisely by notice handlers that carried an eventId. Returned
    // so the controller can skip its blanket per-event sweep — and, when EMPTY, deliberately fall
    // back to it. See FactoryRequestContext.evictedEventKeys.
    const evictedEventKeys = new Set<string>();
    // Prefixes whose narrowing cannot be trusted this request — see
    // FactoryRequestContext.unnarrowablePrefixes. Returned alongside the evicted keys so the
    // controller can sweep exactly those tiers instead of sparing them.
    const unnarrowablePrefixes = new Set<string>();
    // Every notice topic this mutation fired — see FactoryRequestContext.noticeTopics. Returned so
    // the controller can decide whether the participant roster could possibly have changed.
    const noticeTopics = new Set<string>();
    // Collect cache keys to clear AFTER save to avoid race condition
    // where an HTTP read repopulates the cache with stale data between
    // cache-clear (during mutation) and save (after mutation).
    const cacheKeysToDelete: string[] = [];
    const deferredClearCache = {
      del: (key: string) => cacheKeysToDelete.push(key),
      set: services?.cacheManager?.set?.bind(services.cacheManager),
    };

    // READ-MODEL PROJECTION: when the outbox feature is enabled, create a
    // request-scoped delta buffer that the getMutationEngine subscription
    // handlers fill with per-row dirty-intents. Flushed post-commit below.
    // When disabled, the buffer is undefined and every recorder is a no-op —
    // zero mutation-path behavior change.
    const projectionOutbox = services?.projectionOutbox;
    const deltaBuffer = projectionOutbox?.isEnabled ? createDeltaBuffer(tournamentIds) : undefined;

    // DRAW INTEGRITY (report only, deferred — helpers/executionQueueIntegrity.ts). The notice wrapper fills these
    // with the drawIds this mutation's notices name; with DRAW_INTEGRITY_MODE=off they stay undefined and the
    // wrapper records nothing. The scan targets are taken inside the lock once the save has committed, and the
    // scan itself is scheduled only after the lock is released and the response is built.
    const integrityEnabled = drawIntegrityMode() !== 'off';
    const touchedDrawIds = integrityEnabled ? new Set<string>() : undefined;
    const deletedDrawIds = integrityEnabled ? new Set<string>() : undefined;
    const addedDrawIds = integrityEnabled ? new Set<string>() : undefined;
    let integrityBatch: DrawIntegrityBatch | undefined;

    // DECISION: establish this mutation's OWN factory engine state before taking the lock.
    // WHY: the engine state was previously seeded once at module scope, so every request in the
    // process shared one object. withTournamentLock only serialises mutations on the SAME
    // tournament, so a different-tournament mutation — or any concurrent read calling
    // queryEngine.setState — could replace the records this mutation is working on during
    // `await mutationEngine.executionQueue(...)`. The context propagates into the lock callback
    // and every async step below it. See competition-factory#4564.
    const requestContext = {
      publicNotices,
      deltaBuffer,
      evictedEventKeys,
      unnarrowablePrefixes,
      noticeTopics,
      touchedDrawIds,
      deletedDrawIds,
      addedDrawIds,
      services: {
        ...services,
        cacheManager: deferredClearCache,
        tournamentStorageService: storage,
        auditService,
        userId: payload?.userId,
        userEmail: payload?.userEmail,
        auditSource: payload?.auditSource?.type === 'provisioner' ? 'provisioner' : (payload?.source ?? 'tmx'),
      },
    };

    const mutationResult = await runWithRequestContext(requestContext, async () =>
      asyncGlobalState.runWithInstanceState(async () =>
        withTournamentLock(tournamentIds, () =>
          runDurableCommand(payload, services?.commandReceipts, async () => {
            // LOAD PROFILE (Stage 0 of tournament-affinity sharding): the clock
            // starts after the lock is acquired, so what is measured is the work
            // itself — fetch, mutate, save — and not time spent queueing behind
            // another mutation on the same tournament. Lock-wait is a different
            // measurement with a different meaning and mixing them would make a
            // contended tournament look expensive when it is merely popular.
            const startedAt = Date.now();

            const result: any = await storage.fetchTournamentRecords({ tournamentIds });
            if (result.error) return result;

            // Backfill drawId/eventId for matchUpId-only setMatchUpStatus calls
            // (score-relay-style producers don't know the drawId). Runs against
            // the lock-acquired record, replacing the prior pre-lock fetch in
            // setMatchUpStatus.ts that doubled the storage round-trip.
            await resolveMatchUpReferences(methods, result.tournamentRecords);

            // After getMutationEngine(): constructing the engine resets this request's instance state.
            const mutationEngine = getMutationEngine();
            const loaded = loadFetchedRecords(result.tournamentRecords);
            if (loaded.error) return loaded;
            const innerResult = await mutationEngine.executionQueue(methods, rollbackOnError);
            // When the saved rows were written, and when they had been written before this mutation (read
            // inside the lock, so nothing came between). The ack and the broadcast carry both: a client that
            // was current at `previousServerUpdatedAt` and applies this mutation is current at
            // `serverUpdatedAt`; one that was behind stays behind, and its staleness probe says so (P49).
            let serverUpdatedAt: Record<string, string> | undefined;
            const previousServerUpdatedAt: Record<string, string> | undefined = result.serverUpdatedAt;
            // The engine's live records, read without a copy: the save serialises them and the projection
            // below only reads them. Read from the provider rather than from `result.tournamentRecords`,
            // because the queue may have replaced the object it was given.
            const mutatedTournamentRecords: any = asyncGlobalState.getTournamentRecords();

            if (innerResult.success) {
              const updateResult: any = await storage.saveTournamentRecords({
                tournamentRecords: mutatedTournamentRecords,
                // This path raised factory notices, so the delta buffer below
                // already holds the incremental projection — the facade must not
                // re-project the whole tournament on every mutation.
                projectionMode: 'deltas',
              });
              if (!updateResult.success) {
                // A fenced save is NOT a retryable persistence failure — it means
                // this process was deposed as owner of the tournament and the
                // record it just mutated represents a history that no longer
                // exists. Surfaced distinctly (`fenced: true`) so the caller
                // re-resolves its route rather than retrying, and so the ack
                // carries the real reason. Both paths return early, which is what
                // keeps the cache-clear, audit, and projection-flush hooks below
                // from running against a write that never landed.
                if (updateResult.fenced) {
                  recordLoadProfile({
                    services,
                    tournamentIds,
                    tournamentRecords: result.tournamentRecords,
                    methodCount: methods.length,
                    elapsedMs: Date.now() - startedAt,
                    bytes: {},
                    fenced: true,
                  });
                  return { error: updateResult.error, fenced: true, tournamentIds };
                }
                return { error: 'Could not persist tournament record(s)', retryable: true };
              }

              recordLoadProfile({
                services,
                tournamentIds,
                tournamentRecords: mutatedTournamentRecords,
                methodCount: methods.length,
                elapsedMs: Date.now() - startedAt,
                bytes: updateResult.bytes ?? {},
              });
              serverUpdatedAt = updateResult.serverUpdatedAt;

              // Still inside the lock, and only once the write has committed: a rolled-back durable command never
              // runs this, so the scan can never report on a state that was not saved. References, not copies —
              // see snapshotTouchedDraws. Synchronous and non-throwing.
              await afterCommandCommit(async () => {
                integrityBatch = snapshotTouchedDraws({
                  tournamentRecords: mutatedTournamentRecords,
                  touchedDrawIds,
                  deletedDrawIds,
                  addedDrawIds,
                  methods,
                });
              });
            }

            // READ-MODEL PROJECTION FLUSH: after the save, inside the lock. Build per-row deltas
            // from the mutation's FINAL saved state and enqueue them to the outbox. Inside a
            // durable command the enqueue joins the command's transaction (transactional
            // outbox, C2): the deltas commit or roll back with the record and its receipt, so
            // a crash after COMMIT cannot lose them and a rolled-back command leaves none.
            // Failed mutations skip this (innerResult.success false) so the read model can
            // never get ahead of the record. Fail-soft: an outbox error is logged but never
            // blocks the ack — reconciliation/rebuild backstops.
            if (deltaBuffer && projectionOutbox && innerResult.success) {
              try {
                const deltas = await buildProjectionDeltas({
                  intents: deltaBuffer.intents,
                  tournamentRecords: mutatedTournamentRecords,
                  // Bounded per-draw flatten against the mutation's FINAL saved state.
                  // Uses tournamentEngineAsync (per-request async_hooks isolation — the
                  // same engine resolveMatchUpReferences uses) because the mutation
                  // engine instance does not expose query methods. It shares this
                  // request's instance state, which already holds the saved records, so
                  // the query reads them in place instead of copying the whole record
                  // once per draw. Runs post-save, and the query writes nothing.
                  flattenDraw: async (tournamentId: string, drawId: string) => {
                    if (!mutatedTournamentRecords?.[tournamentId]) return [];
                    if (asyncGlobalState.getTournamentRecords() !== mutatedTournamentRecords) {
                      asyncGlobalState.setTournamentRecords(mutatedTournamentRecords);
                    }
                    const res: any = await tournamentEngineAsync.allDrawMatchUps({
                      tournamentId,
                      drawId,
                      inContext: true,
                    });
                    return res?.matchUps ?? [];
                  },
                });
                await projectionOutbox.enqueue(deltas);
              } catch (err: any) {
                Logger.error(`Projection outbox flush failed: ${err?.message}`, 'executionQueue');
              }

              // PUBLIC PARTICIPANT DOCUMENTS (W3): one row per stale tournament, inside the lock and the command's
              // transaction, like a snapshot request. Projection-Producer builds the documents off the lock. Only a
              // participant or policy change requests one, so scoring adds nothing here. Fail-soft, as above.
              try {
                const stale = documentRequestTournamentIds({ intents: deltaBuffer.intents, methods, tournamentIds });
                if (stale.length) await projectionOutbox.requestParticipantDocuments(stale, 'mutation');
              } catch (err: any) {
                Logger.error(`Participant document request failed: ${err?.message}`, 'executionQueue');
              }
            }

            await afterCommandCommit(async () => {
              // Now that save is complete, flush deferred cache deletions
              for (const key of cacheKeysToDelete) {
                services?.cacheManager?.del(key);
              }

              // AUDIT HOOK: record the mutation after save completes, inside the lock.
              // Fail-soft: audit errors are logged but never block the ack.
              if (auditService) {
                auditService
                  .recordMutation({
                    tournamentIds,
                    userId: payload?.userId,
                    userEmail: payload?.userEmail,
                    source: payload?.auditSource?.type === 'provisioner' ? 'provisioner' : (payload?.source ?? 'tmx'),
                    methods: methods.map((m: any) => ({ method: m.method, params: m.params })),
                    status: innerResult.success ? 'applied' : innerResult.error ? 'rejected' : 'partial',
                    errorCode: serializeErrorCode(innerResult.error),
                    metadata: buildAuditMetadata(payload),
                  })
                  .catch((err) => Logger.error(`Audit hook failed: ${err.message}`, 'executionQueue'));
              }
            });

            const canonicalResult =
              payload?.serverStamped && innerResult.success
                ? {
                    ...innerResult,
                    appliedMethods: structuredClone(methods),
                  }
                : innerResult;
            return serverUpdatedAt ? { ...canonicalResult, serverUpdatedAt, previousServerUpdatedAt } : canonicalResult;
          }),
        ),
      ),
    );

    Logger.debug(`[executionQueue] publicNotices: ${publicNotices.length}`);
    // Opt-in cache warming, here rather than in the controller so it stays beside the mutation it
    // follows; the controller passes `trackCacheKey` so a warmed key enters its side-table.
    // Runs after the mutation has been saved, so the rebuilt payload reflects the write.
    const warmedEventKeys = payload?.warmCache
      ? await warmEventDataCache({
          evictedEventKeys: [...evictedEventKeys],
          cacheManager: services?.cacheManager,
          trackKey: services?.trackCacheKey,
          storage,
        })
      : [];

    // After the lock is released and the response is built: the scans run on later turns of the event loop, so
    // nothing here waits on them and nothing they do can reach this request. REPORT ONLY on this path, whatever
    // DRAW_INTEGRITY_MODE says (`enforce` governs the wholesale save; enforcing here is a separate decision).
    // Changes in a draw's finding set are also persisted (draw_integrity_findings) when the bag carries the writer.
    scheduleDrawIntegrityScan(integrityBatch, services?.drawIntegrityFindings);

    return {
      ...mutationResult,
      publicNotices,
      evictedEventKeys: [...evictedEventKeys],
      unnarrowablePrefixes: [...unnarrowablePrefixes],
      noticeTopics: [...noticeTopics],
      warmedEventKeys,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Logger.error(`executionQueue exception for tournaments [${tournamentIds.join(', ')}]: ${message}`);
    // Capture exceptions in the audit log too — these are the most opaque
    // failures (e.g. storage timeout, lock acquisition failure) and the
    // ones most useful to triage post-incident.
    if (auditService) {
      auditService
        .recordMutation({
          tournamentIds,
          userId: payload?.userId,
          userEmail: payload?.userEmail,
          source: payload?.auditSource?.type === 'provisioner' ? 'provisioner' : (payload?.source ?? 'tmx'),
          methods: methods.map((m: any) => ({ method: m.method, params: m.params })),
          status: 'rejected',
          errorCode: message,
          metadata: buildAuditMetadata(payload),
        })
        .catch((auditErr) => Logger.error(`Audit hook failed (catch branch): ${auditErr.message}`, 'executionQueue'));
    }
    if (payload?.commandId !== undefined) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException('Durable command outcome uncertain; retry with the same command ID');
    }
    return { error: message, tournamentIds };
  }
}

/**
 * Hand the fetched records to this request's engine state without copying them.
 *
 * `engine.setState(records)` copies every record, and `setState(records, false)` would avoid that
 * only by turning copying off for the whole process: the factory keeps that flag in module scope,
 * not in the per-request instance state, so every concurrent request would lose its copies too.
 * Storage parses each fetch from its own row, so nothing else holds these objects and the copy
 * protects nothing. The rollback snapshot is unaffected: the factory still copies for it.
 *
 * Mirrors the checks `setState` makes on a keyed object, which the provider call does not.
 */
function loadFetchedRecords(tournamentRecords: Record<string, any> | undefined) {
  const valid =
    !!tournamentRecords &&
    typeof tournamentRecords === 'object' &&
    Object.keys(tournamentRecords).every((id) => tournamentRecords[id]?.tournamentId === id);
  if (!valid) return { error: factoryConstants.errorConditionConstants.INVALID_RECORDS };

  asyncGlobalState.setTournamentId(undefined);
  asyncGlobalState.setTournamentRecords(tournamentRecords);
  return { success: true };
}

/**
 * Reduce a factory error to a stable, queryable string for
 * `audit_log.error_code`. Factory errors are objects (`{ code, message }`),
 * but some internal failures return a plain string (e.g. 'Storage not
 * provided'). The prior `String(error)` stringified the OBJECT case to the
 * useless literal "[object Object]", which made it impossible to filter
 * rejected rows by failure class. Prefer the stable `code` (e.g.
 * ERR_INVALID_DATE), fall back to the human message, then a JSON dump.
 */
function serializeErrorCode(error: any): string | undefined {
  if (!error) return undefined;
  if (typeof error === 'string') return error;
  return error.code ?? error.message ?? JSON.stringify(error);
}

/**
 * Pack the durable correlation fields from a TMX payload into the audit
 * `metadata` JSONB. Keys that aren't present in the payload are omitted so
 * the JSONB stays compact for REST/provisioner paths that don't supply them.
 */
function buildAuditMetadata(payload: any): Record<string, any> | undefined {
  const meta: Record<string, any> = {};
  if (payload?.ackId) meta.ackId = payload.ackId;
  if (payload?.tmxVersion) meta.tmxVersion = payload.tmxVersion;
  if (payload?.factoryVersion) meta.factoryVersion = payload.factoryVersion;
  if (payload?.timestamp) meta.clientTimestamp = payload.timestamp;
  return Object.keys(meta).length ? meta : undefined;
}

/**
 * Emit one load-profile sample per tournament touched by this mutation
 * (Stage 0 of tournament-affinity sharding — see
 * Mentat/planning/CFS_TOURNAMENT_AFFINITY_SHARDING.md).
 *
 * Synchronous and non-throwing by construction: `LoadProfileService.record()`
 * is a few map operations, buffers in memory, and flushes on an interval. It
 * runs on the mutation hot path inside the tournament lock, which is precisely
 * why it must never await a write — instrumenting the path with a per-mutation
 * Postgres round-trip would add latency to the code being measured and change
 * the shape of what it reports.
 *
 * Absent from `services` (any caller that has not been wired, and every unit
 * test) this is a no-op — telemetry must never be able to fail a mutation.
 */
function recordLoadProfile({
  services,
  tournamentIds,
  tournamentRecords,
  methodCount,
  elapsedMs,
  bytes,
  fenced,
}: {
  services?: any;
  tournamentIds: string[];
  tournamentRecords?: Record<string, any>;
  methodCount: number;
  elapsedMs: number;
  bytes: Record<string, number>;
  fenced?: boolean;
}): void {
  const loadProfile = services?.loadProfile;
  if (!loadProfile?.record) return;

  for (const tournamentId of tournamentIds) {
    loadProfile.record({
      tournamentId,
      tournamentRecord: tournamentRecords?.[tournamentId],
      elapsedMs,
      methodCount,
      recordBytes: bytes[tournamentId] ?? 0,
      fenced,
    });
  }
}

/**
 * Backfill `drawId`/`eventId` on `setMatchUpStatus` methods that only
 * carry a `matchUpId`. Operates on the lock-acquired tournament record
 * passed in by the caller — no additional storage round-trip.
 *
 * Scope: only the single-tournament case. For a multi-tournament
 * executionQueue payload, we refuse to guess which tournament owns the
 * matchUpId — searching all records risks resolving to the wrong
 * tournament's draw (matchUpIds are usually UUIDs but can collide in
 * fixtures or replay payloads, and the factory error from "no match"
 * is preferable to mutating the wrong draw). The caller is expected to
 * pass drawId/eventId explicitly in that case.
 *
 * Mutates each eligible method's `params` in place. Uses
 * `tournamentEngineAsync` — the per-request-isolated engine variant
 * built atop `asyncEngine()` + `importMethods(governors, true, 1)`.
 * Each request gets its own state, so a concurrent call to the same
 * helper (or anywhere else that reads from `tournamentEngineAsync`)
 * can't contaminate this one's `setState(...).findMatchUp(...)` pair.
 *
 * Closes code-review fix #9 from the 2026-06-01 punch-list-cleanup
 * session. Earlier the call used the sync `tournamentEngine` singleton
 * and relied on the read-only invariant "no other src/ caller touches
 * the sync engine on the same hot path" — fragile by design. The
 * factory promoted `tournamentEngineAsync` to its public index in PR
 * #4405 so this swap is now possible without a custom governor build.
 */
async function resolveMatchUpReferences(
  methods: any[],
  tournamentRecords: Record<string, any> | undefined,
): Promise<void> {
  if (!methods?.length || !tournamentRecords) return;
  const tournamentIds = Object.keys(tournamentRecords);
  if (tournamentIds.length !== 1) return;
  const tournamentRecord = tournamentRecords[tournamentIds[0]];
  if (!tournamentRecord) return;

  // tournamentEngineAsync's setState + findMatchUp return promises; the
  // per-call state isolation runs the methods through asyncEngineInvoke
  // which is genuinely async. Each iteration awaits both calls.
  for (const m of methods) {
    if (m?.method !== 'setMatchUpStatus') continue;
    const params = m.params;
    if (!params?.matchUpId) continue;
    if (params.drawId || params.eventId) continue;
    await tournamentEngineAsync.setState(tournamentRecord);
    const found: any = await tournamentEngineAsync.findMatchUp({ matchUpId: params.matchUpId });
    if (found?.matchUp?.drawId) {
      params.drawId = found.matchUp.drawId;
      if (found.matchUp.eventId) params.eventId = found.matchUp.eventId;
    }
  }
}
