import { executionQueue } from './executionQueue';

// types
import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

/**
 * Thin score-relay-style entry point. score-relay (and any other
 * matchUpId-only producer) doesn't know the drawId. executionQueue
 * resolves drawId/eventId against the lock-acquired tournament record
 * before dispatching — avoids a redundant pre-lock storage fetch.
 */
export async function setMatchUpStatus(payload: any, services: any, storage: TournamentStorageService) {
  const hasLegacyWrapper = payload?.params && !payload?.matchUpId;
  const flat = hasLegacyWrapper ? payload.params : payload ?? {};
  const { tournamentId, ...params } = flat;

  const methods = [{ method: 'setMatchUpStatus', params }];
  return await executionQueue({ tournamentId, methods }, services, storage);
}
