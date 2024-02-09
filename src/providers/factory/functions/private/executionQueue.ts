import { getMutationEngine } from '../../engines/mutationEngine';
import { recordStorage } from '../../../../data/fileSystem';
import { Logger } from '@nestjs/common';

export async function executionQueue(payload: any, cacheManager?: any) {
  const { executionQueue = [] } = payload ?? {};
  const tournamentIds = payload?.tournamentIds || (payload?.tournamentId && [payload.tournamentId]) || [];
  !!cacheManager;

  if (!tournamentIds.length) {
    Logger.error('No tournamentRecord provided');
    return { error: 'No tournamentIds provided' };
  }

  const result: any = await recordStorage.fetchTournamentRecords({ tournamentIds });
  if (result.error) return result;

  const mutationEngine = getMutationEngine();
  mutationEngine.setState(result.tournamentRecords);
  const mutationResult = await mutationEngine.executionQueue(executionQueue);

  if (mutationResult.success) {
    const mutatedTournamentRecords: any = mutationEngine.getState().tournamentRecords;
    const updateResult = await recordStorage.saveTournamentRecords({
      tournamentRecords: mutatedTournamentRecords,
    });
    if (!updateResult.success) {
      return { error: 'Coult not persist tournament record(s)' };
    }
  }

  return mutationResult;
}
