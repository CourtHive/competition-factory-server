import { readModel } from 'tods-competition-factory';

import { ProjectionDelta } from 'src/storage/interfaces/projection-outbox-storage.interface';

import { ProjectionIntent } from './projectionTypes';
import {
  TABLE_TOURNAMENTS,
  TABLE_EVENTS,
  TABLE_DRAWS,
  TABLE_STRUCTURES,
  TABLE_SEEDS,
  TABLE_MATCH_UPS,
  TABLE_MATCH_UP_COMPETITORS,
  TABLE_ENTRIES,
  TABLE_VENUES,
  TABLE_COURTS,
  TABLE_ORDER_OF_PLAY,
  TABLE_SCHEDULING_PROFILE,
  TABLE_TOURNAMENT_VENUES,
  LINK_CANONICAL,
} from './projectionConstants';

// Row builders + person/publish resolution come from the factory read-model
// toolkit — the SINGLE source shared with cast() (no CFS-local copy). The
// incremental producer stays per-draw; it just reuses the same row logic.
const {
  entryRows,
  eventRow,
  drawRow,
  structureRow,
  seedRow,
  matchUpResultRow,
  matchUpRowSet,
  tournamentRow,
  venueRow,
  courtRow,
  orderOfPlayRow,
  schedulingProfileRows,
  resolveMatchUpPublishState,
  getEventPublishStatus,
  getTournamentPublishStatus,
} = readModel;
type MatchUpRowContext = readModel.MatchUpRowContext;

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
  events: Set<string>; // tournamentIds needing an events refresh
  draws: Map<string, string>; // drawId → tournamentId (draw + its structures re-project)
  seeds: Map<string, string>; // structureId → tournamentId (seeds re-project per structure)
  orderOfPlay: Set<string>; // tournamentIds needing an order-of-play publish-state refresh
  schedulingProfiles: Map<string, any[]>; // tournamentId → the scheduling plan to re-project
  matchUpResults: Map<string, { tournamentId: string; matchUp: any }>; // matchUpId → latest
  venues: Map<string, { tournamentId: string; venue: any }>; // venueId → venue
  deleteVenues: { tournamentId: string; venueId: string }[];
  deleteDraws: { tournamentId: string; drawId: string }[];
  deleteMatchUps: Map<string, string>; // matchUpId → tournamentId
  deleteEvents: Map<string, string>; // eventId → tournamentId (dedups AUDIT + DELETE_EVENT)
  deleteParticipants: { tournamentId: string; participantIds: string[] }[];
  claims: Map<string, { tournamentId: string; participantId: string; personId: string }>; // participantId → claim
}

function drawKey(tournamentId: string, drawId: string): string {
  return `${tournamentId}::${drawId}`;
}

function group(intents: ProjectionIntent[], records: Record<string, any>): Grouped {
  const g: Grouped = {
    flattenDraws: new Map(),
    touched: new Set(),
    participants: new Set(),
    events: new Set(),
    draws: new Map(),
    seeds: new Map(),
    orderOfPlay: new Set(),
    schedulingProfiles: new Map(),
    matchUpResults: new Map(),
    venues: new Map(),
    deleteVenues: [],
    deleteDraws: [],
    deleteMatchUps: new Map(),
    deleteEvents: new Map(),
    deleteParticipants: [],
    claims: new Map(),
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
      case 'entries':
        // Same entries-fact refresh as `participants`, but a pure entry change does
        // not alter the tournaments row, so it does not force a tournaments upsert.
        g.participants.add(intent.tournamentId);
        break;
      case 'events':
        g.events.add(intent.tournamentId);
        break;
      case 'draw':
        g.draws.set(intent.drawId, intent.tournamentId);
        break;
      case 'seeds':
        g.seeds.set(intent.structureId, intent.tournamentId);
        break;
      case 'orderOfPlay':
        g.orderOfPlay.add(intent.tournamentId);
        break;
      case 'schedulingProfile':
        g.schedulingProfiles.set(intent.tournamentId, intent.schedulingProfile);
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
      case 'deleteMatchUps':
        for (const matchUpId of intent.matchUpIds) g.deleteMatchUps.set(matchUpId, intent.tournamentId);
        break;
      case 'deleteEvent':
        g.deleteEvents.set(intent.eventId, intent.tournamentId);
        break;
      case 'deleteParticipants':
        g.deleteParticipants.push(intent);
        break;
      case 'claimPerson':
        g.claims.set(intent.participantId, intent);
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

// The event's PUBLIC publish status (the `PUBLISH.STATUS` timeItem value),
// cached per event within a flatten. Same source cast() uses, so the per-matchUp
// publish INTENT + embargo resolve identically across both projection paths.
function eventPublishStatus(record: any, cache: Map<string, any>, eventId?: string): any {
  if (!eventId) return undefined;
  if (cache.has(eventId)) return cache.get(eventId);
  const event = (record?.events ?? []).find((e: any) => e?.eventId === eventId);
  const status = event ? getEventPublishStatus({ event }) : undefined;
  cache.set(eventId, status);
  return status;
}

function upsert(
  tournamentId: string,
  table: string,
  key: Record<string, any>,
  row: Record<string, any>,
  topic: string,
): ProjectionDelta {
  return { tournamentId, op: 'upsert', table, key, row, topic };
}

function del(tournamentId: string, table: string, key: Record<string, any>, topic: string): ProjectionDelta {
  return { tournamentId, op: 'delete', table, key, topic };
}

function update(
  tournamentId: string,
  table: string,
  key: Record<string, any>,
  row: Record<string, any>,
): ProjectionDelta {
  return { tournamentId, op: 'update', table, key, row, topic: 'claimPerson' };
}

// A person self-claim stamps the canonical personId onto every competitor +
// entry row for the claimed participant (targeted UPDATE — we don't know the
// competitor PKs, so match by participant column). Makes the self-claimed rows
// visible to the person-scoped query.
function claimDeltas(g: Grouped): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = [];
  for (const { tournamentId, participantId, personId } of g.claims.values()) {
    deltas.push(
      update(
        tournamentId,
        TABLE_MATCH_UP_COMPETITORS,
        { individual_participant_id: participantId },
        { person_id: personId, link_source: LINK_CANONICAL },
      ),
    );
    deltas.push(
      update(
        tournamentId,
        TABLE_ENTRIES,
        { tournament_id: tournamentId, participant_id: participantId },
        { person_id: personId },
      ),
    );
  }
  return deltas;
}

async function flattenDrawDeltas(
  g: Grouped,
  args: BuildDeltasArgs,
  coveredMatchUpIds: Set<string>,
): Promise<ProjectionDelta[]> {
  const deltas: ProjectionDelta[] = [];
  for (const { tournamentId, drawId } of g.flattenDraws.values()) {
    const matchUps = await args.flattenDraw(tournamentId, drawId);
    const record = args.tournamentRecords?.[tournamentId];
    const providerId = providerIdOf(args.tournamentRecords, tournamentId);
    const statusCache = new Map<string, any>();
    for (const matchUp of matchUps ?? []) {
      // A team draw's flatten returns each rubber BOTH nested under its TEAM
      // matchUp (as tieMatchUps) AND as a top-level sibling. Skip the top-level
      // rubber (it carries a collectionId) — it is projected as a RUBBER row via
      // its TEAM parent below, so processing it here too would double-project it
      // (once STANDARD, once RUBBER) onto the same match_up_id.
      if (matchUp?.collectionId) continue;
      // publish INTENT + embargo resolve per-matchUp through the structure/stage/
      // draw cascade (embargo is stored, never collapsed into a visible flag).
      const status = eventPublishStatus(record, statusCache, matchUp?.eventId);
      const { published, embargo } = resolveMatchUpPublishState(
        status,
        matchUp?.drawId,
        matchUp?.structureId,
        matchUp?.stage,
      );
      const ctx: MatchUpRowContext = { tournamentId, providerId, published, embargo };
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
    coveredMatchUpIds.add(row.match_up_id); // a re-scored matchUp must not be deleted this cycle
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

// One `events` row per event of each touched tournament. `published` is resolved
// the SAME way cast() does (`!!getEventPublishStatus`) so the incremental rows are
// byte-identical to a rebuild. provider_id comes from the record's parentOrganisation.
function eventDeltas(g: Grouped, records: Record<string, any>): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = [];
  for (const tournamentId of g.events) {
    const record = records?.[tournamentId];
    if (!record) continue;
    const providerId = providerIdOf(records, tournamentId);
    for (const event of record.events ?? []) {
      if (!event?.eventId) continue;
      const published = !!getEventPublishStatus({ event });
      const row = eventRow(event, tournamentId, providerId, published);
      deltas.push(upsert(tournamentId, TABLE_EVENTS, { event_id: row.event_id }, row, 'events'));
    }
  }
  return deltas;
}

// Locate a structure + its owning event/draw in the final record (for a seeds
// re-projection, the intent carries only the structureId).
function findStructureContext(
  record: any,
  structureId: string,
): { eventId: string; drawId: string; structure: any } | undefined {
  for (const event of record?.events ?? []) {
    for (const draw of event.drawDefinitions ?? []) {
      for (const structure of draw.structures ?? []) {
        if (structure?.structureId === structureId) {
          return { eventId: event.eventId, drawId: draw.drawId, structure };
        }
      }
    }
  }
  return undefined;
}

// Locate a draw + its owning event in the final record (a draw intent carries only drawId).
function findDrawContext(record: any, drawId: string): { eventId: string; draw: any } | undefined {
  for (const event of record?.events ?? []) {
    for (const draw of event.drawDefinitions ?? []) {
      if (draw?.drawId === drawId) return { eventId: event.eventId, draw };
    }
  }
  return undefined;
}

// Per draw: upsert the draw row, then delete-by-draw + re-insert its top-level
// structures (a structure can be added/removed within a draw). The draw upsert
// precedes its structures (structures FK → draws), and the structures delete
// precedes their re-inserts (array = apply order).
function drawDeltas(g: Grouped, records: Record<string, any>): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = [];
  for (const [drawId, tournamentId] of g.draws) {
    const record = records?.[tournamentId];
    if (!record) continue;
    const found = findDrawContext(record, drawId);
    if (!found) continue; // draw gone (deleted) → its delete deltas handle removal
    const providerId = providerIdOf(records, tournamentId);
    const drawRowData = drawRow(found.draw, tournamentId, found.eventId, providerId);
    deltas.push(upsert(tournamentId, TABLE_DRAWS, { draw_id: drawId }, drawRowData, 'draw'));
    deltas.push(del(tournamentId, TABLE_STRUCTURES, { draw_id: drawId }, 'draw'));
    for (const structure of found.draw.structures ?? []) {
      if (!structure?.structureId) continue;
      const sctx = { tournamentId, eventId: found.eventId, drawId, providerId };
      const row = structureRow(structure, sctx);
      deltas.push(upsert(tournamentId, TABLE_STRUCTURES, { structure_id: row.structure_id }, row, 'draw'));
    }
  }
  return deltas;
}

// Seeds re-project PER STRUCTURE as delete-by-structure THEN re-insert: a seed set
// can SHRINK (a cleared seed), which an upsert-only refresh would leave stale. The
// delete is emitted before its upserts (array order = apply order), so on a rebuild
// (empty table) it is a harmless no-op and the net equals cast().
function seedDeltas(g: Grouped, records: Record<string, any>): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = [];
  for (const [structureId, tournamentId] of g.seeds) {
    const record = records?.[tournamentId];
    if (!record) continue;
    deltas.push(del(tournamentId, TABLE_SEEDS, { structure_id: structureId }, 'seeds'));
    const found = findStructureContext(record, structureId);
    if (!found) continue; // structure gone (its draw was deleted) → the delete stands alone
    const providerId = providerIdOf(records, tournamentId);
    for (const assignment of found.structure.seedAssignments ?? []) {
      if (!assignment?.participantId) continue;
      const ctx = { tournamentId, eventId: found.eventId, drawId: found.drawId, structureId, providerId };
      const row = seedRow(assignment, ctx);
      deltas.push(
        upsert(tournamentId, TABLE_SEEDS, { structure_id: row.structure_id, seed_number: row.seed_number }, row, 'seeds'),
      );
    }
  }
  return deltas;
}

// Order-of-play PUBLICATION state: one row when published, resolved from the final
// record (same source cast() uses); an unpublish deletes the row.
function orderOfPlayDeltas(g: Grouped, records: Record<string, any>): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = [];
  for (const tournamentId of g.orderOfPlay) {
    const record = records?.[tournamentId];
    if (!record) continue;
    const oop = getTournamentPublishStatus({ tournamentRecord: record })?.orderOfPlay;
    if (oop?.published) {
      const row = orderOfPlayRow(tournamentId, oop);
      deltas.push(upsert(tournamentId, TABLE_ORDER_OF_PLAY, { tournament_id: tournamentId }, row, 'orderOfPlay'));
    } else {
      deltas.push(del(tournamentId, TABLE_ORDER_OF_PLAY, { tournament_id: tournamentId }, 'orderOfPlay'));
    }
  }
  return deltas;
}

// The scheduling PLAN: delete-by-tournament + re-insert the flattened rows (the plan
// can shrink). Projected from the intent's profile (byte-identical to cast, which reads
// the same stored profile).
function schedulingProfileDeltas(g: Grouped): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = [];
  for (const [tournamentId, profile] of g.schedulingProfiles) {
    deltas.push(del(tournamentId, TABLE_SCHEDULING_PROFILE, { tournament_id: tournamentId }, 'schedulingProfile'));
    for (const row of schedulingProfileRows(tournamentId, profile)) {
      deltas.push(
        upsert(
          tournamentId,
          TABLE_SCHEDULING_PROFILE,
          {
            tournament_id: row.tournament_id,
            schedule_date: row.schedule_date,
            venue_id: row.venue_id,
            round_order: row.round_order,
          },
          row,
          'schedulingProfile',
        ),
      );
    }
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

function venueDeltas(g: Grouped, records: Record<string, any>): ProjectionDelta[] {
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
    // courts nest under the venue: delete-by-venue + re-insert (a court can be
    // added/removed within a venue). The venue upsert precedes them (courts FK → venues).
    const providerId = providerIdOf(records, tournamentId);
    deltas.push(del(tournamentId, TABLE_COURTS, { venue_id: row.venue_id }, 'venue'));
    for (const court of venue.courts ?? []) {
      if (!court?.courtId) continue;
      const courtRowData = courtRow(court, { venueId: row.venue_id, tournamentId, providerId });
      deltas.push(upsert(tournamentId, TABLE_COURTS, { court_id: courtRowData.court_id }, courtRowData, 'venue'));
    }
  }
  return deltas;
}

function deleteDeltas(g: Grouped, coveredMatchUpIds: Set<string>): ProjectionDelta[] {
  const deltas: ProjectionDelta[] = [];
  for (const { tournamentId, venueId } of g.deleteVenues) {
    deltas.push(
      del(tournamentId, TABLE_TOURNAMENT_VENUES, { tournament_id: tournamentId, venue_id: venueId }, 'deleteVenue'),
    );
  }
  for (const { tournamentId, drawId } of g.deleteDraws) {
    deltas.push(del(tournamentId, TABLE_MATCH_UPS, { draw_id: drawId }, 'deleteDraw')); // competitors cascade
    deltas.push(del(tournamentId, TABLE_SEEDS, { draw_id: drawId }, 'deleteDraw')); // seeds don't FK a structures table
    deltas.push(del(tournamentId, TABLE_DRAWS, { draw_id: drawId }, 'deleteDraw')); // structures cascade via draws FK
  }
  // Individual matchUp removals. A matchUp that was ALSO (re)built this cycle is in
  // coveredMatchUpIds — skip it, else the delete (emitted last) would undo the upsert
  // for a draw replace that reuses the same matchUpIds. Competitors cascade on the FK.
  for (const [matchUpId, tournamentId] of g.deleteMatchUps) {
    if (coveredMatchUpIds.has(matchUpId)) continue;
    deltas.push(del(tournamentId, TABLE_MATCH_UPS, { match_up_id: matchUpId }, 'deletedMatchUpIds'));
  }
  for (const [eventId, tournamentId] of g.deleteEvents) {
    deltas.push(del(tournamentId, TABLE_EVENTS, { event_id: eventId }, 'deleteEvent'));
    deltas.push(del(tournamentId, TABLE_MATCH_UPS, { event_id: eventId }, 'deleteEvent'));
    deltas.push(del(tournamentId, TABLE_ENTRIES, { tournament_id: tournamentId, event_id: eventId }, 'deleteEvent'));
    deltas.push(del(tournamentId, TABLE_SEEDS, { event_id: eventId }, 'deleteEvent'));
    deltas.push(del(tournamentId, TABLE_DRAWS, { event_id: eventId }, 'deleteEvent')); // structures cascade via draws FK
  }
  for (const { tournamentId, participantIds } of g.deleteParticipants) {
    for (const participantId of participantIds) {
      deltas.push(
        del(
          tournamentId,
          TABLE_ENTRIES,
          { tournament_id: tournamentId, participant_id: participantId },
          'deleteParticipants',
        ),
      );
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
    ...eventDeltas(g, args.tournamentRecords),
    ...drawDeltas(g, args.tournamentRecords),
    ...seedDeltas(g, args.tournamentRecords),
    ...orderOfPlayDeltas(g, args.tournamentRecords),
    ...schedulingProfileDeltas(g),
    ...venueDeltas(g, args.tournamentRecords),
    ...flatten,
    ...resultDeltas(g, args.tournamentRecords, coveredMatchUpIds),
    ...entryDeltas(g, args.tournamentRecords),
    ...claimDeltas(g),
    ...deleteDeltas(g, coveredMatchUpIds),
  ];
}
