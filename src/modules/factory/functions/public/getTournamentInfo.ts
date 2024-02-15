import { queryGovernor } from 'tods-competition-factory';

export async function getTournamentInfo({ tournamentId }, services?: any) {
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };
  const findResult = await services.storage.findTournamentRecord({ tournamentId });
  if (findResult.error) return findResult;
  const infoResult = queryGovernor.getTournamentInfo({ tournamentRecord: findResult.tournamentRecord });
  if (infoResult.error) return infoResult;
  return infoResult.tournamentInfo;
}
