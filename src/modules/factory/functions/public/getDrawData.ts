import { queryGovernor, fixtures, Tournament } from 'tods-competition-factory';

import type { ITournamentStorage } from 'src/storage/interfaces';

/**
 * One draw's data — the draw tier of the payload decomposition
 * (`Mentat/planning/PUBLISH_WARMCACHE_AND_PAYLOAD_DECOMPOSITION.md`).
 *
 * Mirrors `getEventData`'s privacy policy and participant profile exactly: a public reader must not see
 * more through the draw route than through the event route. Any divergence here is a privacy leak, not
 * a formatting difference.
 *
 * `structuresProfile: 'STUBS'` narrows further — cheap per-structure metadata with no `roundMatchUps`.
 */
export async function getDrawData(params: any, storage: ITournamentStorage) {
  if (!params?.tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };
  if (!params?.drawId) return { error: 'MISSING_DRAW_ID' };

  const findResult = await storage.findTournamentRecord({ tournamentId: params.tournamentId });
  if (findResult.error) return findResult;
  const tournamentRecord = findResult.tournamentRecord as Tournament;

  const { drawDefinition, event } = queryGovernor.findDrawDefinition({
    drawId: params.drawId,
    tournamentRecord,
  }) as any;
  if (!drawDefinition) return { error: 'DRAW_DEFINITION_NOT_FOUND' };

  const policyDefinitions = fixtures.policies.POLICY_PRIVACY_DEFAULT as any;
  policyDefinitions.participant.participant.person.sex = true;
  policyDefinitions.participant.participant.rankings = true;
  policyDefinitions.participant.participant.seedings = true;
  policyDefinitions.participant.participant.ratings = true;
  policyDefinitions.participant.participant.teams = true;

  return queryGovernor.getDrawData({
    participantsProfile: {
      convertExtensions: true,
      withScaleValues: true,
      withGroupings: true,
      withISO2: true,
      withIOC: true,
    },
    contextProfile: { withCompetitiveness: true },
    structuresProfile: params?.structuresProfile,
    includePositionAssignments: true,
    allParticipantResults: true,
    usePublishState: true,
    pressureRating: true,
    refreshResults: true,
    tournamentRecord,
    policyDefinitions,
    drawDefinition,
    event,
  });
}
