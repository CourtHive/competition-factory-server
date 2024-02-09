import { queryGovernor } from 'tods-competition-factory';
import levelStorage from 'src/data/netLevel';

export async function getTournamentInfo({ tournamentId }) {
  const findResult = await levelStorage.findTournamentRecord({ tournamentId });
  if (findResult.error) return findResult;
  const infoResult = queryGovernor.getTournamentInfo({ tournamentRecord: findResult.tournamentRecord });
  if (infoResult.error) return infoResult;
  return infoResult.tournamentInfo;
}
