import { queryTournamentRecords } from './queryTournamentRecords';

import type { ITournamentStorage } from 'src/storage/interfaces';

export async function allTournamentMatchUps(params: any, storage: ITournamentStorage) {
  const { tournamentId, matchUpStatuses, ...rest } = params;
  const method = 'allTournamentMatchUps';
  const payload = {
    params: { ...rest, usePublishState: true, matchUpFilters: { matchUpStatuses } },
    tournamentId,
    method,
  };
  return queryTournamentRecords(payload, storage);
}
