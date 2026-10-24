import { queryGovernor, Tournament } from 'tods-competition-factory';

import { resolvePublicParticipantPolicy } from './participantPrivacyPolicy';
import type { ITournamentStorage, IProviderStorage } from 'src/storage/interfaces';

// The inferred return type reaches HydratedParticipant, which tods-competition-factory does not export, so
// declaration emit cannot name it (TS2883). Each branch is named here through exported symbols instead.
export type EventDataResult =
  | { error: string }
  | Awaited<ReturnType<ITournamentStorage['findTournamentRecord']>>
  | ReturnType<typeof queryGovernor.getEventData>;

export async function getEventData(
  params: any,
  storage: ITournamentStorage,
  providerStorage?: IProviderStorage,
): Promise<EventDataResult> {
  if (!params.tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };
  const findResult = await storage.findTournamentRecord({ tournamentId: params.tournamentId });
  if (findResult.error) return findResult;
  const tournamentRecord = findResult.tournamentRecord as Tournament;
  const policyDefinitions = await resolvePublicParticipantPolicy({ tournamentRecord, providerStorage });
  const infoResult = queryGovernor.getEventData({
    participantsProfile: {
      convertExtensions: true,
      withScaleValues: true,
      withGroupings: true,
      withISO2: true,
      withIOC: true,
    },
    tournamentRecord,
    hydrateParticipants: params?.hydrateParticipants,
    contextProfile: { withCompetitiveness: true },
    includePositionAssignments: true,
    allParticipantResults: true,
    eventId: params.eventId,
    // Undefined leaves the factory's own FULL default in place; an unknown value is rejected there
    // rather than silently falling through to FULL.
    ...(params.drawsProfile !== undefined && { drawsProfile: params.drawsProfile }),
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
