import { withTournamentLock } from 'src/services/tournamentMutex';
import { getMutationEngine } from '../../engines/getMutationEngine';
import { Logger } from '@nestjs/common';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

export async function executionQueue(payload: any, services?: any, storage?: TournamentStorageService): Promise<any> {
  const { methods = [], rollbackOnError } = payload ?? {};
  const tournamentIds = payload?.tournamentIds || (payload?.tournamentId && [payload.tournamentId]) || [];

  if (!tournamentIds.length) {
    Logger.error('No tournamentRecord provided');
    return { error: 'No tournamentIds provided' };
  }

  if (!storage) return { error: 'Storage not provided' };

  try {
    return await withTournamentLock(tournamentIds, async () => {
      const result: any = await storage.fetchTournamentRecords({ tournamentIds });
      if (result.error) return result;

      const mutationEngine = getMutationEngine({ ...services, tournamentStorageService: storage });
      mutationEngine.setState(result.tournamentRecords);
      const mutationResult = await mutationEngine.executionQueue(methods, rollbackOnError);

      if (mutationResult.success) {
        const mutatedTournamentRecords: any = mutationEngine.getState().tournamentRecords;
        const updateResult = await storage.saveTournamentRecords({
          tournamentRecords: mutatedTournamentRecords,
        });
        if (!updateResult.success) {
          return { error: 'Could not persist tournament record(s)' };
        }
      }

      return mutationResult;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Logger.error(`executionQueue exception for tournaments [${tournamentIds.join(', ')}]: ${message}`);
    return { error: message, tournamentIds };
  }
}
