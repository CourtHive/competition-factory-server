import { executionQueue } from './executionQueue';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

export async function setMatchUpStatus(payload: any, services: any, storage: TournamentStorageService) {
  const { params = {} } = payload ?? {};
  const { tournamentId } = params;
  const methods = [{ method: 'setMatchUpStatus', params }];
  return await executionQueue({ tournamentId, methods, services }, undefined, storage);
}
