import { queryGovernor } from 'tods-competition-factory';

export async function getTournamentMatchUps(params, services) {
  const { tournamentId, ...opts } = params;
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };
  const findResult = await services.storage.findTournamentRecord({ tournamentId });
  if (findResult.error) return findResult;
  const matchUpsResult = queryGovernor.competitionScheduleMatchUps({
    tournamentRecord: findResult.tournamentRecord,
    ...opts,
  });
  if (matchUpsResult.error) return matchUpsResult;
  return matchUpsResult;
}
