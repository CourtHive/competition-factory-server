import { executionQueue } from './executionQueue';

export async function setMatchUpStatus(payload: any, cacheManager: any) {
  const { params = {} } = payload ?? {};
  const methods = [{ method: 'setMatchUpStatus', params }];
  return await executionQueue({ methods }, cacheManager);
}
