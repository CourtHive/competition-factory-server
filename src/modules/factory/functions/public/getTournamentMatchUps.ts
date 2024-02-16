import { fixtures, queryGovernor } from 'tods-competition-factory';
import levelStorage from 'src/services/levelDB';

import { SUCCESS } from 'src/common/constants/app';

export async function getTournamentMatchUps(params) {
  const { tournamentId, ...opts } = params;
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };

  const findResult: any = await levelStorage.fetchTournamentRecords({ tournamentId });
  if (findResult.error) return findResult;

  const matchUpsResult = queryGovernor.competitionScheduleMatchUps({
    policyDefinitions: fixtures.policies.POLICY_PRIVACTY_DEFAULT,
    tournamentRecords: findResult.tournamentRecords,
    usePublishState: true,
    ...opts,
  });
  if (matchUpsResult.error) return matchUpsResult;
  return { ...SUCCESS, ...matchUpsResult };
}
