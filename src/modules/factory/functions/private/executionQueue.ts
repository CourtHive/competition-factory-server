import { withTournamentLock } from 'src/services/tournamentMutex';
import { getMutationEngine } from '../../engines/getMutationEngine';
import { tournamentEngineAsync } from 'tods-competition-factory';
import { Logger } from '@nestjs/common';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';
import type { ITournamentProvisionerStorage } from 'src/storage/interfaces';
import type { AuditService } from 'src/modules/audit/audit.service';

export async function executionQueue(
  payload: any,
  services?: any,
  storage?: TournamentStorageService,
  auditService?: AuditService,
  tournamentProvisionerStorage?: ITournamentProvisionerStorage,
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

    const mutationResult = await withTournamentLock(tournamentIds, async () => {
      const result: any = await storage.fetchTournamentRecords({ tournamentIds });
      if (result.error) return result;

      // Backfill drawId/eventId for matchUpId-only setMatchUpStatus calls
      // (score-relay-style producers don't know the drawId). Runs against
      // the lock-acquired record, replacing the prior pre-lock fetch in
      // setMatchUpStatus.ts that doubled the storage round-trip.
      await resolveMatchUpReferences(methods, result.tournamentRecords);

      const mutationEngine = getMutationEngine(
        {
          ...services,
          cacheManager: deferredClearCache,
          tournamentStorageService: storage,
          auditService,
          userId: payload?.userId,
          userEmail: payload?.userEmail,
          auditSource: payload?.auditSource?.type === 'provisioner' ? 'provisioner' : payload?.source ?? 'tmx',
        },
        publicNotices,
      );
      mutationEngine.setState(result.tournamentRecords);
      const innerResult = await mutationEngine.executionQueue(methods, rollbackOnError);

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
        auditService.recordMutation({
          tournamentIds,
          userId: payload?.userId,
          userEmail: payload?.userEmail,
          source: payload?.auditSource?.type === 'provisioner' ? 'provisioner' : payload?.source ?? 'tmx',
          methods: methods.map((m: any) => ({ method: m.method, params: m.params })),
          status: innerResult.success ? 'applied' : innerResult.error ? 'rejected' : 'partial',
          errorCode: innerResult.error ? String(innerResult.error) : undefined,
          metadata: buildAuditMetadata(payload),
        }).catch((err) => Logger.error(`Audit hook failed: ${err.message}`, 'executionQueue'));
      }

      return innerResult;
    });

    Logger.debug(`[executionQueue] publicNotices: ${publicNotices.length}`);
    return { ...mutationResult, publicNotices };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Logger.error(`executionQueue exception for tournaments [${tournamentIds.join(', ')}]: ${message}`);
    // Capture exceptions in the audit log too — these are the most opaque
    // failures (e.g. storage timeout, lock acquisition failure) and the
    // ones most useful to triage post-incident.
    if (auditService) {
      auditService.recordMutation({
        tournamentIds,
        userId: payload?.userId,
        userEmail: payload?.userEmail,
        source: payload?.auditSource?.type === 'provisioner' ? 'provisioner' : payload?.source ?? 'tmx',
        methods: methods.map((m: any) => ({ method: m.method, params: m.params })),
        status: 'rejected',
        errorCode: message,
        metadata: buildAuditMetadata(payload),
      }).catch((auditErr) => Logger.error(`Audit hook failed (catch branch): ${auditErr.message}`, 'executionQueue'));
    }
    return { error: message, tournamentIds };
  }
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
    tournamentProvisionerStorage.create({ tournamentId: tid, provisionerId, providerId }).catch((err) =>
      Logger.error(`Provisioner stamp failed for ${tid}: ${err.message}`, 'executionQueue'),
    );
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
  storage.saveTournamentRecords({ tournamentRecords: resaveRecords }).catch((err) =>
    Logger.error(`Provisioner extension re-save failed: ${err.message}`, 'executionQueue'),
  );
}
