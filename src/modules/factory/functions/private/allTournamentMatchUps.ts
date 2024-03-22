import { queryTournamentRecords } from './queryTournamentRecords';

export async function allTournamentMatchUps(params: any) {
  const { tournamentId, matchUpStatuses, ...rest } = params;
  const method = 'allTournamentMatchUps';
  const payload = {
    params: { ...rest, usePublishState: true, matchUpFilters: { matchUpStatuses } },
    tournamentId,
    method,
  };
  return queryTournamentRecords(payload);
}
