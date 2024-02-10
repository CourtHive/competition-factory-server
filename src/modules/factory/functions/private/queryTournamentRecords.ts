import { queryEngine } from 'src/modules/factory/engines/queryEngine';
import { Logger } from '@nestjs/common';

export async function queryTournamentRecords(payload, services?: any) {
  const tournamentIds = payload?.tournamentIds || (payload?.tournamentId && [payload.tournamentId]) || [];

  if (!tournamentIds.length) {
    Logger.error('No tournamentRecord provided');
    return { error: 'No tournamentIds provided' };
  }

  const result: any = await services.storage.fetchTournamentRecords({ tournamentIds });
  if (result.error) return result;
  queryEngine.setState(result.tournamentRecords);

  const { method, params } = payload;
  return queryEngine[method](params);
}
