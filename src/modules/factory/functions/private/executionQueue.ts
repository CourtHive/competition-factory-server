import { tournamentEngineAsync, factoryConstants } from 'tods-competition-factory';
import asyncGlobalState from 'src/modules/factory/engines/asyncGlobalState';
import { runWithRequestContext } from 'src/modules/factory/engines/requestContext';
import { withTournamentLock } from 'src/services/tournamentMutex';
import { getMutationEngine } from '../../engines/getMutationEngine';
import { computeEffectiveConfig } from '@courthive/provider-config';
import { buildProjectionDeltas } from '../../projection/buildProjectionDeltas';
import { createDeltaBuffer } from '../../projection/deltaBuffer';
import { Logger } from '@nestjs/common';

import type { ITournamentProvisionerStorage, IProviderStorage } from 'src/storage/interfaces';
import type { TournamentStorageService } from 'src/storage/tournament-storage.service';
import type { AuditService } from 'src/modules/audit/audit.service';

const POLICY_TYPE_PARTICIPANT = factoryConstants.policyConstants.POLICY_TYPE_PARTICIPANT;

export async function executionQueue(
  payload: any,
  services?: any,
  storage?: TournamentStorageService,
  auditService?: AuditService,
  tournamentProvisionerStorage?: ITournamentProvisionerStorage,
  providerStorage?: IProviderStorage,
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
        withTournamentLock(tournamentIds, async () => {
          const result: any = await storage.fetchTournamentRecords({ tournamentIds });
          if (result.error) return result;

          // Backfill drawId/eventId for matchUpId-only setMatchUpStatus calls
          // (score-relay-style producers don't know the drawId). Runs against
          // the lock-acquired record, replacing the prior pre-lock fetch in
          // setMatchUpStatus.ts that doubled the storage round-trip.
          await resolveMatchUpReferences(methods, result.tournamentRecords);

          const mutationEngine = getMutationEngine();
          mutationEngine.setState(result.tournamentRecords);
          const innerResult = await mutationEngine.executionQueue(methods, rollbackOnError);

          // PRIVACY ATTACH HOOK: when a new tournament is created, attach the
          // owning provider's selected participant-privacy policy to the record
          // BEFORE save so public reads (getParticipants) honor it immediately.
          // The appended methods are returned as `appliedServerMethods` so the
          // TMX client can replay them locally and keep its state in sync — a
          // general server-directive mechanism, not privacy-specific. Fail-soft:
          // a resolution error never blocks the create ack.
          const appliedServerMethods = innerResult.success
            ? await attachProviderPolicies({ methods, tournamentIds, mutationEngine, providerStorage })
            : [];

          if (innerResult.success) {
            const mutatedTournamentRecords: any = mutationEngine.getState().tournamentRecords;
            const updateResult = await storage.saveTournamentRecords({
              tournamentRecords: mutatedTournamentRecords,
            });
            if (!updateResult.success) {
              return { error: 'Could not persist tournament record(s)' };
            }
          }

          // Now that save is complete, flush deferred cache deletions
          for (const key of cacheKeysToDelete) {
            services?.cacheManager?.del(key);
          }

          // PROVISIONER HOOK: stamp tournament_provisioner mapping and
          // parentOrganisation.extensions when a provisioner creates a tournament.
          // Fail-soft: errors are logged but never block the ack.
          if (innerResult.success && payload?.provisioner?.provisionerId && tournamentProvisionerStorage) {
            const hasNewTournament = methods.some((m: any) => m.method === 'newTournamentRecord');
            if (hasNewTournament) {
              stampProvisionerOrigin({
                tournamentIds,
                provisioner: payload.provisioner,
                tournamentProvisionerStorage,
                mutationEngine,
                storage,
              });
            }
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

          // READ-MODEL PROJECTION FLUSH: post-commit, inside the lock (the exact
          // seam the audit hook + deferred cache-clear use). Build per-row deltas
          // from the mutation's FINAL saved state and enqueue them to the outbox.
          // Rolled-back / failed mutations skip this (innerResult.success false) so
          // the read model can never get ahead of the record. Fail-soft: an outbox
          // error is logged but never blocks the ack — reconciliation/rebuild backstops.
          if (deltaBuffer && projectionOutbox && innerResult.success) {
            try {
              const finalRecords: any = mutationEngine.getState().tournamentRecords;
              const deltas = await buildProjectionDeltas({
                intents: deltaBuffer.intents,
                tournamentRecords: finalRecords,
                // Bounded per-draw flatten against the mutation's FINAL saved state.
                // Uses tournamentEngineAsync (per-request async_hooks isolation — the
                // same engine resolveMatchUpReferences uses) because the mutation
                // engine instance does not expose query methods. Runs post-save, so
                // re-setState on the isolated engine can't perturb the committed record.
                flattenDraw: async (tournamentId: string, drawId: string) => {
                  const record = finalRecords?.[tournamentId];
                  if (!record) return [];
                  await tournamentEngineAsync.setState(record);
                  const res: any = await tournamentEngineAsync.allDrawMatchUps({ drawId, inContext: true });
                  return res?.matchUps ?? [];
                },
              });
              await projectionOutbox.enqueue(deltas);
            } catch (err: any) {
              Logger.error(`Projection outbox flush failed: ${err?.message}`, 'executionQueue');
            }
          }

          return appliedServerMethods.length ? { ...innerResult, appliedServerMethods } : innerResult;
        }),
      ),
    );

    Logger.debug(`[executionQueue] publicNotices: ${publicNotices.length}`);
    return { ...mutationResult, publicNotices };
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
    return { error: message, tournamentIds };
  }
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

/**
 * On new-tournament creation, attach the owning provider's selected
 * participant-privacy policy to each created tournamentRecord (in the
 * already-executing mutationEngine, before save). Returns the method
 * descriptors that were actually applied, so the caller can hand them back
 * to the client as `appliedServerMethods` for local replay.
 *
 * Runs only when the batch contains a `newTournamentRecord` method. The
 * owning provider is resolved from the created record's
 * `parentOrganisation.organisationId` — the same field `getParticipants`
 * uses — so the provisioner and TMX creation paths resolve identically.
 * `attachPolicies` is idempotent per policy type (it skips a type already
 * present), so a record that somehow already carries the policy is a no-op.
 * Fail-soft: any provider-lookup or attach error is swallowed per-record and
 * never blocks the create.
 */
export async function attachProviderPolicies({
  methods,
  tournamentIds,
  mutationEngine,
  providerStorage,
}: {
  methods: any[];
  tournamentIds: string[];
  mutationEngine: any;
  providerStorage?: IProviderStorage;
}): Promise<any[]> {
  if (!providerStorage) return [];
  const hasNewTournament = methods.some((m: any) => m?.method === 'newTournamentRecord');
  if (!hasNewTournament) return [];

  const applied: any[] = [];
  const tournamentRecords: any = mutationEngine.getState().tournamentRecords ?? {};

  for (const tournamentId of tournamentIds) {
    const record = tournamentRecords[tournamentId];
    const providerId = record?.parentOrganisation?.organisationId;
    if (!providerId) continue;

    let policy: Record<string, any> | undefined;
    try {
      const provider: any = await providerStorage.getProvider(providerId);
      const effective = computeEffectiveConfig(provider?.providerConfigCaps, provider?.providerConfigSettings);
      policy = effective?.participantPrivacyPolicy;
    } catch (err: any) {
      Logger.error(`Privacy policy resolve failed for provider ${providerId}: ${err?.message}`, 'executionQueue');
      continue;
    }
    if (!policy || !Object.keys(policy).length) continue;

    const attachMethod = {
      method: 'attachPolicies',
      params: { policyDefinitions: { [POLICY_TYPE_PARTICIPANT]: policy }, tournamentId },
    };
    try {
      const res: any = await mutationEngine.executionQueue([attachMethod], false);
      if (res?.success) applied.push(attachMethod);
    } catch (err: any) {
      Logger.error(`Privacy policy attach failed for ${tournamentId}: ${err?.message}`, 'executionQueue');
    }
  }

  return applied;
}

/** Fire-and-forget: stamp tournament_provisioner table + parentOrganisation extension. */
function stampProvisionerOrigin({
  tournamentIds,
  provisioner,
  tournamentProvisionerStorage,
  mutationEngine,
  storage,
}: {
  tournamentIds: string[];
  provisioner: { provisionerId: string; providerId: string; provisionerName?: string };
  tournamentProvisionerStorage: ITournamentProvisionerStorage;
  mutationEngine: any;
  storage: TournamentStorageService;
}) {
  const { provisionerId, providerId } = provisioner;

  // Insert relational mapping rows
  for (const tid of tournamentIds) {
    tournamentProvisionerStorage
      .create({ tournamentId: tid, provisionerId, providerId })
      .catch((err) => Logger.error(`Provisioner stamp failed for ${tid}: ${err.message}`, 'executionQueue'));
  }

  // Stamp provisionerOrigin extension on parentOrganisation
  const mutatedRecords: any = mutationEngine.getState().tournamentRecords;
  for (const tid of tournamentIds) {
    const record = mutatedRecords?.[tid];
    if (!record?.parentOrganisation) continue;

    const extensions = record.parentOrganisation.extensions ?? [];
    const ext = {
      name: 'provisionerOrigin',
      value: { provisionerId, provisionerName: provisioner.provisionerName, createdAt: new Date().toISOString() },
    };
    const idx = extensions.findIndex((e: any) => e.name === 'provisionerOrigin');
    if (idx >= 0) {
      extensions[idx] = ext;
    } else {
      extensions.push(ext);
    }
    record.parentOrganisation.extensions = extensions;
  }

  // Re-save with the extension stamped
  const resaveRecords: any = mutationEngine.getState().tournamentRecords;
  storage
    .saveTournamentRecords({ tournamentRecords: resaveRecords })
    .catch((err) => Logger.error(`Provisioner extension re-save failed: ${err.message}`, 'executionQueue'));
}
