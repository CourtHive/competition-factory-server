import { competitionEngine } from './competitionEngine';
import { recordStorage } from '../../../data/fileSystem';
import { Logger } from '@nestjs/common';

export async function executionQueue(payload: any) {
  const { executionQueue = [] } = payload ?? {}; // TODO: types
  const tournamentIds =
    payload?.tournamentIds ||
    (payload?.tournamentId && [payload.tournamentId]) ||
    [];

  if (!tournamentIds.length) {
    Logger.error('No tournamentRecord provided');
    return { error: 'No tournamentIds provided' };
  }

  const tournamentRecords = await recordStorage.fetchTournamentRecords(
    tournamentIds,
  );
  competitionEngine.setState(tournamentRecords);
  const mutationResult = await competitionEngine.executionQueue(executionQueue);

  if (!mutationResult.success) {
    const mutatedTournamentRecords: any[] =
      competitionEngine.getState().tournamentRecords;
    const updateResult = await recordStorage.saveTournamentRecords({
      tournamentRecords: mutatedTournamentRecords,
    });
    if (!updateResult.success) {
      return { error: 'Coult not persist tournament record(s)' };
    }
  }

  return mutationResult;
}
