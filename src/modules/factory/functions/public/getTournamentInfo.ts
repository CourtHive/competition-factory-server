import { queryGovernor, Tournament } from 'tods-competition-factory';

import type { ITournamentStorage } from 'src/storage/interfaces';
import { SUCCESS } from 'src/common/constants/app';

export async function getTournamentInfo(
  {
    tournamentId,
    withMatchUpStats,
    withStructureDetails,
    usePublishState = true,
    withVenueData,
  }: {
    tournamentId: string;
    withMatchUpStats?: boolean;
    withStructureDetails?: boolean;
    usePublishState?: boolean;
    withVenueData?: boolean;
  },
  storage: ITournamentStorage,
) {
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };
  const findResult = await storage.findTournamentRecord({ tournamentId });
  if (findResult.error) return findResult;
  const infoResult = queryGovernor.getTournamentInfo({
    tournamentRecord: findResult.tournamentRecord as Tournament,
    withStructureDetails,
    withMatchUpStats,
    usePublishState,
    withVenueData,
  });
  if (infoResult.error) return infoResult;
  return { ...SUCCESS, tournamentInfo: infoResult.tournamentInfo };
}
