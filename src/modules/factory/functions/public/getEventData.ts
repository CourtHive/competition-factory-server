import { queryGovernor, fixtures } from 'tods-competition-factory';
import levelStorage from 'src/services/levelDB';

export async function getEventData(params: any) {
  if (!params.tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };
  const findResult = await levelStorage.findTournamentRecord({ tournamentId: params.tournamentId });
  if (findResult.error) return findResult;
  const policyDefinitions = fixtures.policies.POLICY_PRIVACY_DEFAULT;
  policyDefinitions.participant.participant.person.sex = true;
  policyDefinitions.participant.participant.rankings = true;
  policyDefinitions.participant.participant.ratings = true;
  const infoResult = queryGovernor.getEventData({
    participantsProfile: { withScaleValues: true },
    tournamentRecord: findResult.tournamentRecord,
    allParticipantResults: true,
    eventId: params.eventId,
    usePublishState: true,
    pressureRating: true,
    refreshResults: true,
    policyDefinitions,
  });
  if (infoResult.error) return infoResult;
  return infoResult;
}
