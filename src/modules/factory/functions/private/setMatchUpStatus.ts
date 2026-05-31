import { tournamentEngine } from 'tods-competition-factory';
import { executionQueue } from './executionQueue';

// types
import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

export async function setMatchUpStatus(payload: any, services: any, storage: TournamentStorageService) {
  // Support both DTO shape (tournamentId at top level) and legacy wrapper ({ params: { tournamentId, ... } })
  const hasLegacyWrapper = payload?.params && !payload?.matchUpId;
  const flat = hasLegacyWrapper ? payload.params : payload ?? {};
  const { tournamentId, ...params } = flat;

  // score-relay-style callers (and any other matchUpId-only producer)
  // don't know the drawId. The factory's setMatchUpStatus needs it to
  // resolve a drawDefinition — so we look the matchUp up here and
  // backfill drawId/eventId before dispatching.
  if (tournamentId && params.matchUpId && !params.drawId && !params.eventId) {
    const resolved = await resolveDrawIdFromMatchUpId(tournamentId, params.matchUpId, storage);
    if (resolved.drawId) params.drawId = resolved.drawId;
    if (resolved.eventId) params.eventId = resolved.eventId;
  }

  const methods = [{ method: 'setMatchUpStatus', params }];
  return await executionQueue({ tournamentId, methods }, services, storage);
}

/**
 * Look up the matchUp inside the tournament record and pull its
 * drawId/eventId. Returns empties if anything is missing — callers
 * fall through to executionQueue which will surface a sensible error.
 */
async function resolveDrawIdFromMatchUpId(
  tournamentId: string,
  matchUpId: string,
  storage: TournamentStorageService,
): Promise<{ drawId?: string; eventId?: string }> {
  try {
    const result: any = await storage.fetchTournamentRecords({ tournamentIds: [tournamentId] });
    const tournamentRecord = result?.tournamentRecords?.[tournamentId];
    if (!tournamentRecord) return {};
    const { matchUp } = tournamentEngine.setState(tournamentRecord).findMatchUp({ matchUpId });
    if (!matchUp) return {};
    return { drawId: matchUp.drawId, eventId: matchUp.eventId };
  } catch {
    return {};
  }
}
