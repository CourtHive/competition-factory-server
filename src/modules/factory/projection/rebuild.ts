import { CANONICAL_PERSON } from 'src/common/constants/canonicalPerson';

import { ProjectionIntent } from './projectionTypes';

/**
 * The full projection-intent set for ONE tournament, used by the rebuild /
 * backfill pipeline. It reuses the SAME `buildProjectionDeltas` + `projectionRows`
 * code the incremental producers use — so a from-scratch rebuild yields
 * byte-identical read rows to the incremental (outbox) path (the anti-divergence
 * guarantee; proven by the conformance test).
 *
 * Intents: the tournament row (touch) + entries (participants) + one flatten per
 * draw (match_ups + competitors) + each venue + a claimPerson per participant
 * already carrying a CANONICAL_PERSON stamp (this is how the backfill aligns
 * HISTORICAL self-claims — the rows that predate the incremental claim handler).
 */
export function buildRebuildIntents(record: any): ProjectionIntent[] {
  const tournamentId = record?.tournamentId;
  if (!tournamentId) return [];

  const intents: ProjectionIntent[] = [
    { kind: 'touchTournament', tournamentId },
    { kind: 'participants', tournamentId },
    { kind: 'events', tournamentId },
    { kind: 'orderOfPlay', tournamentId },
    { kind: 'participantPublish', tournamentId },
    // the stored scheduling plan (NATIVE `scheduling.profile`; LEGACY extension records
    // do not surface here, matching cast's NATIVE-first read on the same records)
    { kind: 'schedulingProfile', tournamentId, schedulingProfile: record?.scheduling?.profile ?? [] },
  ];

  for (const event of record?.events ?? []) {
    for (const draw of event?.drawDefinitions ?? []) {
      if (draw?.drawId) {
        intents.push({ kind: 'flattenDraw', tournamentId, drawId: draw.drawId });
        intents.push({ kind: 'draw', tournamentId, drawId: draw.drawId });
      }
      for (const structure of draw?.structures ?? []) {
        if (structure?.structureId) intents.push({ kind: 'seeds', tournamentId, structureId: structure.structureId });
      }
    }
  }

  for (const venue of record?.venues ?? []) {
    if (venue?.venueId) intents.push({ kind: 'venue', tournamentId, venue });
  }

  for (const participant of record?.participants ?? []) {
    const participantId = participant?.participantId;
    const canonical = (participant?.person?.personOtherIds ?? []).find(
      (o: any) => o?.organisationId === CANONICAL_PERSON,
    );
    if (participantId && canonical?.personId) {
      intents.push({ kind: 'claimPerson', tournamentId, participantId, personId: canonical.personId });
    }
  }

  return intents;
}
