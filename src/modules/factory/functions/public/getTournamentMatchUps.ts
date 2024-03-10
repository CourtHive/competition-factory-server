import { fixtures, queryGovernor } from 'tods-competition-factory';
import levelStorage from 'src/services/levelDB';

import { SUCCESS } from 'src/common/constants/app';

export async function getTournamentMatchUps(params) {
  const { tournamentId, ...opts } = params;
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };

  const findResult: any = await levelStorage.fetchTournamentRecords({ tournamentId });
  if (findResult.error) return findResult;

  console.log(
    findResult.tournamentRecords[tournamentId].timeItems?.find(({ itemType }) => itemType === 'PUBLISH.STATUS')
      ?.itemValue,
  );

  const matchUpsResult = queryGovernor.competitionScheduleMatchUps({
    policyDefinitions: fixtures.policies.POLICY_PRIVACTY_DEFAULT,
    tournamentRecords: findResult.tournamentRecords,
    usePublishState: false,
    ...opts, // order is important here because we don't want to overwrite required parameter values
  });
  if (matchUpsResult.error) return matchUpsResult;
  return { ...SUCCESS, ...matchUpsResult };
}
