import { executionQueue } from './executionQueue';

// types
import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

export async function setMatchUpStatus(payload: any, services: any, storage: TournamentStorageService) {
  // The DTO has tournamentId at the top level, not nested inside params
  const { tournamentId, ...params } = payload ?? {};
  const methods = [{ method: 'setMatchUpStatus', params }];
  return await executionQueue({ tournamentId, methods }, services, storage);
}
