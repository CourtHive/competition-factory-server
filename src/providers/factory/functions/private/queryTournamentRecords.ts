import { queryEngine } from 'src/providers/factory/engines/queryEngine';
import recordStorage from 'src/data/fileSystem';
import { Logger } from '@nestjs/common';

export async function queryTournamentRecords(payload) {
  const tournamentIds = payload?.tournamentIds || (payload?.tournamentId && [payload.tournamentId]) || [];

  if (!tournamentIds.length) {
    Logger.error('No tournamentRecord provided');
    return { error: 'No tournamentIds provided' };
  }

  const result: any = await recordStorage.fetchTournamentRecords({ tournamentIds });
  if (result.error) return result;
  queryEngine.setState(result.tournamentRecords);

  const { method, params } = payload;
  return queryEngine[method](params);
}