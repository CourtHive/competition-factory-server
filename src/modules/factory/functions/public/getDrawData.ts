import { queryGovernor, Tournament } from 'tods-competition-factory';

import { findEventForDraw, publicParticipantPrivacyPolicy } from './participantPrivacyPolicy';
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

  const { drawDefinition } = queryGovernor.findDrawDefinition({
    drawId: params.drawId,
    tournamentRecord,
  }) as any;
  if (!drawDefinition) return { error: 'DRAW_DEFINITION_NOT_FOUND' };

  // `publicFindDrawDefinition` returns no `event`, and `usePublishState: true` needs one to decide
  // whether the draw is published — see `findEventForDraw`.
  const event = findEventForDraw(tournamentRecord, params.drawId);

  const policyDefinitions = publicParticipantPrivacyPolicy();

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
