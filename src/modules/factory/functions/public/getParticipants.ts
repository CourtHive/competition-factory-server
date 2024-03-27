import { fixtures, queryGovernor } from 'tods-competition-factory';
import levelStorage from 'src/services/levelDB';

// constants
import { SUCCESS } from 'dist/common/constants/app';

export async function getParticipants(params) {
  const { tournamentId, ...opts } = params;
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };

  const findResult: any = await levelStorage.fetchTournamentRecords({ tournamentId });
  if (findResult.error) return findResult;

  const tournamentRecords = findResult.tournamentRecords;

  const pubStatus = queryGovernor.getTournamentPublishStatus({ tournamentRecords });
  if (!pubStatus?.participants?.published) return { error: 'Participants not published' };

  const participantResult = queryGovernor.getParticipants({
    policyDefinitions: fixtures.policies.POLICY_PRIVACTY_DEFAULT,
    contextFilters: opts?.contextFilters,
    matchUpFilters: opts?.matchUpFilters,
    activeTournamentId: tournamentId,
    withScaleValues: true,
    usePublishState: true, // filters out events that are not published
    tournamentRecords,
    withEvents: true,
    // withISO2: true,
    // withIOC: true,
  });
  if (participantResult.error) return participantResult;

  return { ...SUCCESS, participants: participantResult?.participants };
}
