import { ProjectionDelta } from 'src/storage/interfaces/projection-outbox-storage.interface';

import { ProjectionIntent } from './projectionTypes';
import { entryRows, matchUpResultRow, matchUpRowSet, tournamentRow, venueRow, MatchUpRowContext } from './projectionRows';
import {
  TABLE_TOURNAMENTS,
  TABLE_MATCH_UPS,
  TABLE_MATCH_UP_COMPETITORS,
  TABLE_ENTRIES,
  TABLE_VENUES,
  TABLE_TOURNAMENT_VENUES,
} from './projectionConstants';

export interface BuildDeltasArgs {
  intents: ProjectionIntent[];
  tournamentRecords: Record<string, any>;
  // Bounded per-draw flatten against the mutation's final state — returns the
  // hydrated (in-context) matchUps of ONE draw. Injected so the engine specifics
  // stay in executionQueue and this module is purely testable.
  flattenDraw: (tournamentId: string, drawId: string) => Promise<any[]>;
}

// Grouped, de-duplicated intents.
interface Grouped {
  flattenDraws: Map<string, { tournamentId: string; drawId: string }>; // key tid::drawId
  touched: Set<string>; // tournamentIds needing a tournaments upsert
  participants: Set<string>; // tournamentIds needing an entries refresh
  matchUpResults: Map<string, { tournamentId: string; matchUp: any }>; // matchUpId → latest
  venues: Map<string, { tournamentId: string; venue: any }>; // venueId → venue
  deleteVenues: { tournamentId: string; venueId: string }[];
  deleteDraws: { tournamentId: string; drawId: string }[];
  deleteEvents: { tournamentId: string; eventId: string }[];
  deleteParticipants: { tournamentId: string; participantIds: string[] }[];
}

function drawKey(tournamentId: string, drawId: string): string {
  return `${tournamentId}::${drawId}`;
}

function group(intents: ProjectionIntent[], records: Record<string, any>): Grouped {
  const g: Grouped = {
    flattenDraws: new Map(),
    touched: new Set(),
    participants: new Set(),
    matchUpResults: new Map(),
    venues: new Map(),
    deleteVenues: [],
    deleteDraws: [],
    deleteEvents: [],
    deleteParticipants: [],
  };

  for (const intent of intents) {
    switch (intent.kind) {
      case 'flattenDraw':
        g.flattenDraws.set(drawKey(intent.tournamentId, intent.drawId), intent);
        g.touched.add(intent.tournamentId);
        break;
      case 'republishEvent':
        for (const drawId of eventDrawIds(records, intent.tournamentId, intent.eventId)) {
          g.flattenDraws.set(drawKey(intent.tournamentId, drawId), { tournamentId: intent.tournamentId, drawId });
        }
        g.touched.add(intent.tournamentId);
        break;
      case 'matchUpResult':
        g.matchUpResults.set(intent.matchUp.matchUpId, { tournamentId: intent.tournamentId, matchUp: intent.matchUp });
        break;
      case 'touchTournament':
        g.touched.add(intent.tournamentId);
        break;
      case 'participants':
        g.participants.add(intent.tournamentId);
        g.touched.add(intent.tournamentId);
        break;
      case 'venue':
        g.venues.set(intent.venue.venueId, { tournamentId: intent.tournamentId, venue: intent.venue });
        g.touched.add(intent.tournamentId);
        break;
      case 'deleteVenue':
        g.deleteVenues.push(intent);
        break;
      case 'deleteDraw':
        g.deleteDraws.push(intent);
        break;
      case 'deleteEvent':
        g.deleteEvents.push(intent);
        break;
      case 'deleteParticipants':
        g.deleteParticipants.push(intent);
        break;
    }
  }
  return g;
}

function eventDrawIds(records: Record<string, any>, tournamentId: string, eventId: string): string[] {
  const event = (records?.[tournamentId]?.events ?? []).find((e: any) => e?.eventId === eventId);
  return (event?.drawDefinitions ?? []).map((d: any) => d?.drawId).filter(Boolean);
}

function providerIdOf(records: Record<string, any>, tournamentId: string): string | undefined {
  return records?.[tournamentId]?.parentOrganisation?.organisationId;
}

// published flag for a draw, read from the event's PUBLISH.STATUS timeItem
// (latest wins). Best-effort: unknown → false (visibility stored, not omission).
function deriveDrawPublished(records: Record<string, any>, tournamentId: string, drawId: string): boolean {
  const events = records?.[tournamentId]?.events ?? [];
  const event = events.find((e: any) => (e?.drawDefinitions ?? []).some((d: any) => d?.drawId === drawId));
  const statusItems = (event?.timeItems ?? []).filter((t: any) => t?.itemType === 'PUBLISH.STATUS');
  const itemValue = statusItems.at(-1)?.itemValue?.PUBLIC;
  if (!itemValue) return false;
  const detail = itemValue.drawDetails?.[drawId]?.publishingDetail?.published;
  return detail ?? !!itemValue.published;
}

function upsert(tournamentId: string, table: string, key: Record<string, any>, row: Record<string, any>, topic: string): ProjectionDelta {
  return { tournamentId, op: 'upsert', table, key, row, topic };
}

function del(tournamentId: string, table: string, key: Record<string, any>, topic: string): ProjectionDelta {
  return { tournamentId, op: 'delete', table, key, topic };
}

async function flattenDrawDeltas(
  g: Grouped,
  args: BuildDeltasArgs,
  coveredMatchUpIds: Set<string>,
): Promise<ProjectionDelta[]> {
  const deltas: ProjectionDelta[] = [];
  for (const { tournamentId, drawId } of g.flattenDraws.values()) {
    const matchUps = await args.flattenDraw(tournamentId, drawId);
    const ctx: MatchUpRowContext = {
      tournamentId,
      providerId: providerIdOf(args.tournamentRecords, tournamentId),
      published: deriveDrawPublished(args.tournamentRecords, tournamentId, drawId),
    };
    for (const matchUp of matchUps ?? []) {
      const { matchUpRows, competitorRows } = matchUpRowSet(matchUp, ctx);
      for (const row of matchUpRows) {
        coveredMatchUpIds.add(row.match_up_id);
        deltas.push(upsert(tournamentId, TABLE_MATCH_UPS, { match_up_id: row.match_up_id }, row, 'flattenDraw'));
      }
      for (const row of competitorRows) {
        deltas.push(
          upsert(
            tournamentId,
            TABLE_MATCH_UP_COMPETITORS,
            { match_up_id: row.match_up_id, side_number: row.side_number, competitor_index: row.competitor_index },
            row,
            'flattenDraw',
          ),
        );
      }
    }
  }
  return deltas;
}

function resultDeltas(g: Grouped, records: Record<string, any>, coveredMatchUpIds: Set<string>): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = [];
  for (const { tournamentId, matchUp } of g.matchUpResults.values()) {
    if (coveredMatchUpIds.has(matchUp.matchUpId)) continue; // already fully built by a flatten
    const row = matchUpResultRow(matchUp, tournamentId, providerIdOf(records, tournamentId));
    deltas.push(upsert(tournamentId, TABLE_MATCH_UPS, { match_up_id: row.match_up_id }, row, 'modifyMatchUp'));
  }
  return deltas;
}

function tournamentDeltas(g: Grouped, records: Record<string, any>): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = [];
  for (const tournamentId of g.touched) {
    const record = records?.[tournamentId];
    if (!record) continue;
    const row = tournamentRow(record);
    deltas.push(upsert(tournamentId, TABLE_TOURNAMENTS, { tournament_id: tournamentId }, row, 'touchTournament'));
  }
  return deltas;
}

function entryDeltas(g: Grouped, records: Record<string, any>): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = [];
  for (const tournamentId of g.participants) {
    for (const row of entryRows(records?.[tournamentId])) {
      deltas.push(
        upsert(
          tournamentId,
          TABLE_ENTRIES,
          { tournament_id: row.tournament_id, event_id: row.event_id, participant_id: row.participant_id },
          row,
          'participants',
        ),
      );
    }
  }
  return deltas;
}

function venueDeltas(g: Grouped): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = [];
  for (const { tournamentId, venue } of g.venues.values()) {
    const row = venueRow(venue);
    deltas.push(upsert(tournamentId, TABLE_VENUES, { venue_id: row.venue_id }, row, 'venue'));
    deltas.push(
      upsert(
        tournamentId,
        TABLE_TOURNAMENT_VENUES,
        { tournament_id: tournamentId, venue_id: row.venue_id },
        { tournament_id: tournamentId, venue_id: row.venue_id },
        'venue',
      ),
    );
  }
  return deltas;
}

function deleteDeltas(g: Grouped): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = [];
  for (const { tournamentId, venueId } of g.deleteVenues) {
    deltas.push(del(tournamentId, TABLE_TOURNAMENT_VENUES, { tournament_id: tournamentId, venue_id: venueId }, 'deleteVenue'));
  }
  for (const { tournamentId, drawId } of g.deleteDraws) {
    deltas.push(del(tournamentId, TABLE_MATCH_UPS, { draw_id: drawId }, 'deleteDraw')); // competitors cascade
  }
  for (const { tournamentId, eventId } of g.deleteEvents) {
    deltas.push(del(tournamentId, TABLE_MATCH_UPS, { event_id: eventId }, 'deleteEvent'));
    deltas.push(del(tournamentId, TABLE_ENTRIES, { tournament_id: tournamentId, event_id: eventId }, 'deleteEvent'));
  }
  for (const { tournamentId, participantIds } of g.deleteParticipants) {
    for (const participantId of participantIds) {
      deltas.push(del(tournamentId, TABLE_ENTRIES, { tournament_id: tournamentId, participant_id: participantId }, 'deleteParticipants'));
    }
  }
  return deltas;
}

/**
 * Turn the buffered dirty-intents into concrete read-model deltas against the
 * mutation's FINAL saved state. Ordering respects the read-model FKs: parents
 * (tournaments, venues) upserted before children (match_ups → competitors,
 * entries, tournament_venues); deletes last.
 */
export async function buildProjectionDeltas(args: BuildDeltasArgs): Promise<ProjectionDelta[]> {
  const g = group(args.intents, args.tournamentRecords);
  const coveredMatchUpIds = new Set<string>();

  const flatten = await flattenDrawDeltas(g, args, coveredMatchUpIds);

  return [
    ...tournamentDeltas(g, args.tournamentRecords),
    ...venueDeltas(g),
    ...flatten,
    ...resultDeltas(g, args.tournamentRecords, coveredMatchUpIds),
    ...entryDeltas(g, args.tournamentRecords),
    ...deleteDeltas(g),
  ];
}
