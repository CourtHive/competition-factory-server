import { queryTournamentRecords } from './queryTournamentRecords';

export async function getMatchUps(params: any) {
  const { tournamentId, matchUpStatuses, ...rest } = params;
  const method = 'allTournamentMatchUps';
  const payload = {
    params: { ...rest, usePublishState: true, matchUpFilters: { matchUpStatuses } },
    tournamentId,
    method,
  };
  return queryTournamentRecords(payload);
}
