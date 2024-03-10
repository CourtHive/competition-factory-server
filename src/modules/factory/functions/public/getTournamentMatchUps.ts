import { fixtures, queryGovernor } from 'tods-competition-factory';
import levelStorage from 'src/services/levelDB';

import { SUCCESS } from 'src/common/constants/app';

export async function getTournamentMatchUps(params) {
  const { tournamentId, ...opts } = params;
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };

  const findResult: any = await levelStorage.fetchTournamentRecords({ tournamentId });
  if (findResult.error) return findResult;

  const matchUpsResult = queryGovernor.competitionScheduleMatchUps({
    ...opts, // order is important here because we don't want to overwrite required parameter values
    usePublishState: true,
    tournamentRecords: findResult.tournamentRecords,
    policyDefinitions: fixtures.policies.POLICY_PRIVACTY_DEFAULT,
  });
  if (matchUpsResult.error) return matchUpsResult;
  return { ...SUCCESS, ...matchUpsResult };
}
