import { queryGovernor } from 'tods-competition-factory';
import recordStorage from 'src/data/fileSystem';

export async function getTournamentInfo({ tournamentId }) {
  const findResult = await recordStorage.findTournamentRecord({ tournamentId });
  if (findResult.error) return findResult;
  const infoResult = queryGovernor.getTournamentInfo({ tournamentRecord: findResult.tournamentRecord });
  if (infoResult.error) return infoResult;
  return infoResult.tournamentInfo;
}
