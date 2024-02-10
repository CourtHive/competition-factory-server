import { executionQueue } from './executionQueue';

export async function setMatchUpStatus(payload: any, services: any) {
  const { params = {} } = payload ?? {};
  const methods = [{ method: 'setMatchUpStatus', params }];
  return await executionQueue({ methods, services });
}
