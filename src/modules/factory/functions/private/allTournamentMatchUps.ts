import { queryTournamentRecords } from './queryTournamentRecords';

import type { ITournamentStorage } from 'src/storage/interfaces';

// The factory's allTournamentMatchUps walks every event and reads only matchUpFilters, so the route's top-level
// eventId/drawId must become filters here or they are silently ignored.
export async function allTournamentMatchUps(params: any, storage: ITournamentStorage) {
  const { tournamentId, eventId, drawId, matchUpStatuses, ...rest } = params;
  const method = 'allTournamentMatchUps';
  const matchUpFilters = {
    matchUpStatuses,
    eventIds: eventId ? [eventId] : undefined,
    drawIds: drawId ? [drawId] : undefined,
  };
  const payload = {
    params: { ...rest, usePublishState: true, matchUpFilters },
    tournamentId,
    method,
  };
  return queryTournamentRecords(payload, storage);
}
