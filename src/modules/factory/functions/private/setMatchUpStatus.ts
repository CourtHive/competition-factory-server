import { executionQueue } from './executionQueue';

// types
import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

export async function setMatchUpStatus(payload: any, services: any, storage: TournamentStorageService) {
  // Support both DTO shape (tournamentId at top level) and legacy wrapper ({ params: { tournamentId, ... } })
  const hasLegacyWrapper = payload?.params && !payload?.matchUpId;
  const flat = hasLegacyWrapper ? payload.params : payload ?? {};
  const { tournamentId, ...params } = flat;
  const methods = [{ method: 'setMatchUpStatus', params }];
  return await executionQueue({ tournamentId, methods }, services, storage);
}
