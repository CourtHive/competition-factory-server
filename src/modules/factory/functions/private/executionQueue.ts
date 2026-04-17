import { withTournamentLock } from 'src/services/tournamentMutex';
import { getMutationEngine } from '../../engines/getMutationEngine';
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

      const mutationEngine = getMutationEngine(
        { ...services, cacheManager: deferredClearCache, tournamentStorageService: storage },
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
        }).catch((err) => Logger.error(`Audit hook failed: ${err.message}`, 'executionQueue'));
      }

      return innerResult;
    });

    Logger.debug(`[executionQueue] publicNotices: ${publicNotices.length}`);
    return { ...mutationResult, publicNotices };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Logger.error(`executionQueue exception for tournaments [${tournamentIds.join(', ')}]: ${message}`);
    return { error: message, tournamentIds };
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
