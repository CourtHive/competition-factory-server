import { executionQueue } from './executionQueue';

export async function setMatchUpStatus(payload: any, services: any) {
  const { params = {} } = payload ?? {};
  const { tournamentId } = params;
  const methods = [{ method: 'setMatchUpStatus', params }];
  return await executionQueue({ tournamentId, methods, services });
}
