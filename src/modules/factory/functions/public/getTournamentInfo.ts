import { queryGovernor, Tournament } from 'tods-competition-factory';

import type { ITournamentStorage } from 'src/storage/interfaces';
import { SUCCESS } from 'src/common/constants/app';

export async function getTournamentInfo({ tournamentId }, storage: ITournamentStorage) {
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };
  const findResult = await storage.findTournamentRecord({ tournamentId });
  if (findResult.error) return findResult;
  const infoResult = queryGovernor.getTournamentInfo({
    tournamentRecord: findResult.tournamentRecord as Tournament,
    usePublishState: true,
  });
  if (infoResult.error) return infoResult;
  return { ...SUCCESS, tournamentInfo: infoResult.tournamentInfo };
}
