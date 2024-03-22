import { fixtures, queryGovernor } from 'tods-competition-factory';
import levelStorage from 'src/services/levelDB';

import { SUCCESS } from 'src/common/constants/app';

export async function getCompetitionScheduleMatchUps(params) {
  const { tournamentId, ...opts } = params;
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };

  const findResult: any = await levelStorage.fetchTournamentRecords({ tournamentId });
  if (findResult.error) return findResult;

  const tournamentRecords = findResult.tournamentRecords;

  const matchUpsResult = queryGovernor.competitionScheduleMatchUps({
    policyDefinitions: fixtures.policies.POLICY_PRIVACTY_DEFAULT,
    contextFilters: opts?.contextFilters,
    matchUpFilters: opts?.matchUpFilters,
    activeTournamentId: tournamentId,
    usePublishState: true,
    tournamentRecords,
  });
  if (matchUpsResult.error) return matchUpsResult;
  return { ...SUCCESS, ...matchUpsResult };
}
