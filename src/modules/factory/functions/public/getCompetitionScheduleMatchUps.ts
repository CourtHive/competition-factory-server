import { fixtures, queryGovernor } from 'tods-competition-factory';

import type { ITournamentStorage } from 'src/storage/interfaces';
import { SUCCESS } from 'src/common/constants/app';

export async function getCompetitionScheduleMatchUps(params, storage: ITournamentStorage) {
  const { tournamentId, ...opts } = params ?? {};
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };

  const findResult: any = await storage.fetchTournamentRecords({ tournamentId });
  if (findResult.error) return findResult;

  const tournamentRecords = findResult.tournamentRecords;

  const matchUpsResult = queryGovernor.competitionScheduleMatchUps({
    policyDefinitions: fixtures.policies.POLICY_PRIVACY_DEFAULT,
    courtCompletedMatchUps: opts?.courtCompletedMatchUps,
    hydrateParticipants: opts?.hydrateParticipants,
    contextFilters: opts?.contextFilters,
    matchUpFilters: opts?.matchUpFilters,
    activeTournamentId: tournamentId,
    nextMatchUps: opts?.nextMatchUps,
    usePublishState: true,
    tournamentRecords,
  });
  if (matchUpsResult.error) return matchUpsResult;
  return { ...SUCCESS, ...matchUpsResult };
}
