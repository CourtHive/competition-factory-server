import { queryGovernor } from 'tods-competition-factory';
import levelStorage from 'src/services/levelDB';

import { SUCCESS } from 'src/common/constants/app';

export async function getTournamentInfo({ tournamentId }) {
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };
  const findResult = await levelStorage.findTournamentRecord({ tournamentId });
  if (findResult.error) return findResult;
  const infoResult = queryGovernor.getTournamentInfo({
    tournamentRecord: findResult.tournamentRecord,
    usePublishState: true,
  });
  if (infoResult.error) return infoResult;
  return { ...SUCCESS, tournamentInfo: infoResult.tournamentInfo };
}
