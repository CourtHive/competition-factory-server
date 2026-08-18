import { queryGovernor, fixtures, Tournament } from 'tods-competition-factory';

import type { ITournamentStorage } from 'src/storage/interfaces';

export async function getEventData(params: any, storage: ITournamentStorage) {
  if (!params.tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };
  const findResult = await storage.findTournamentRecord({ tournamentId: params.tournamentId });
  if (findResult.error) return findResult;
  const policyDefinitions = fixtures.policies.POLICY_PRIVACY_DEFAULT as any;
  policyDefinitions.participant.participant.person.sex = true;
  policyDefinitions.participant.participant.rankings = true;
  policyDefinitions.participant.participant.seedings = true;
  policyDefinitions.participant.participant.ratings = true;
  policyDefinitions.participant.participant.teams = true;
  const infoResult = queryGovernor.getEventData({
    participantsProfile: {
      convertExtensions: true,
      withScaleValues: true,
      withGroupings: true,
      withISO2: true,
      withIOC: true,
    },
    tournamentRecord: findResult.tournamentRecord as Tournament,
    hydrateParticipants: params?.hydrateParticipants,
    contextProfile: { withCompetitiveness: true },
    includePositionAssignments: true,
    allParticipantResults: true,
    eventId: params.eventId,
    usePublishState: true,
    pressureRating: true,
    refreshResults: true,
    policyDefinitions,
    // ALWAYS request the stamp, never forward the caller's version to factory.
    //
    // Factory would omit participants on a match, and this result is about to be CACHED — an omitted
    // payload in the cache is exactly the thing that must never happen, because the next caller (who
    // holds no version) would be served a participants-less shape and render every bracket side TBD.
    //
    // So the cache always holds the FULL payload plus its stamp, and the controller strips
    // participants on the way OUT when the caller proves it already has them. Hashing costs ~7.5 ms
    // of an ~87 ms build, paid once per cache fill rather than per request.
    withParticipantsVersion: true,
  });
  if (infoResult.error) return infoResult;
  return infoResult;
}
