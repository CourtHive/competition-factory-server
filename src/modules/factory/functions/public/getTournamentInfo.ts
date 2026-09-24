import { publishingGovernor, queryGovernor, Tournament } from 'tods-competition-factory';

import type { ITournamentStorage } from 'src/storage/interfaces';
import { SUCCESS } from 'src/common/constants/app';

export async function getTournamentInfo(
  {
    tournamentId,
    withMatchUpStats,
    withStructureDetails,
    usePublishState,
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

  // WHEN this tournament may be listed publicly, or null for "now" (factory 7.1.0, P23 D4b). An
  // INSTANT rather than a boolean, deliberately: this result is cached, and an embargo lifting is
  // not a mutation, so nothing evicts the entry when it passes. A cached `visible: false` would keep
  // withholding a tournament whose embargo had lifted; a cached instant is a fact about the record,
  // and the caller compares it to its own clock.
  const visibleFrom = publishingGovernor.getTournamentVisibleFrom({
    tournamentRecord: findResult.tournamentRecord as Tournament,
  });

  return { ...SUCCESS, tournamentInfo: infoResult.tournamentInfo, visibleFrom };
}
