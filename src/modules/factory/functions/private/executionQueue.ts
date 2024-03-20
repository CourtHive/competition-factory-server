import { getMutationEngine } from '../../engines/getMutationEngine';
import levelStorage from 'src/services/levelDB';
import { Logger } from '@nestjs/common';

export async function executionQueue(payload: any, services?: any) {
  const { methods = [], rollbackOnError } = payload ?? {};
  const tournamentIds = payload?.tournamentIds || (payload?.tournamentId && [payload.tournamentId]) || [];

  if (!tournamentIds.length) {
    Logger.error('No tournamentRecord provided');
    return { error: 'No tournamentIds provided' };
  }

  const result: any = await levelStorage.fetchTournamentRecords({ tournamentIds });
  if (result.error) return result;

  const mutationEngine = getMutationEngine(services);
  mutationEngine.setState(result.tournamentRecords);
  const mutationResult = await mutationEngine.executionQueue(methods, rollbackOnError);

  if (mutationResult.success) {
    const mutatedTournamentRecords: any = mutationEngine.getState().tournamentRecords;
    const updateResult = await levelStorage.saveTournamentRecords({
      tournamentRecords: mutatedTournamentRecords,
    });
    if (!updateResult.success) {
      return { error: 'Coult not persist tournament record(s)' };
    }
  }

  return mutationResult;
}
