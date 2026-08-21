import { queryGovernor, Tournament } from 'tods-competition-factory';

import { findEventForDraw, publicParticipantPrivacyPolicy } from './participantPrivacyPolicy';
import type { ITournamentStorage } from 'src/storage/interfaces';

/**
 * One structure's data — the drill-in tier.
 *
 * ⚠️ This narrows the RESPONSE and gives the structure its own cache entry. It does **not** reduce
 * server compute: every draw is a single structure group, so the factory cannot skip assembling
 * siblings (see the correction in
 * `Mentat/planning/PUBLISH_WARMCACHE_AND_PAYLOAD_DECOMPOSITION.md`).
 *
 * The value is cache-key granularity — a score in one structure need not evict another structure's
 * cached payload — plus a smaller body on the wire. Do not describe this endpoint as saving work.
 *
 * Privacy policy and participant profile are identical to the event and draw routes by construction:
 * a public reader must not see more through a narrower route.
 */
export async function getStructureData(params: any, storage: ITournamentStorage) {
  if (!params?.tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };
  if (!params?.drawId) return { error: 'MISSING_DRAW_ID' };
  if (!params?.structureId) return { error: 'MISSING_STRUCTURE_ID' };

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

  return queryGovernor.getStructureData({
    participantsProfile: {
      convertExtensions: true,
      withScaleValues: true,
      withGroupings: true,
      withISO2: true,
      withIOC: true,
    },
    contextProfile: { withCompetitiveness: true },
    structureId: params.structureId,
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
