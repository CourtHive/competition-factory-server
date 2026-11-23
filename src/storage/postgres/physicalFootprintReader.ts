import type { PhysicalFootprintRead, PhysicalFootprintRequest } from '../interfaces/tournament-storage.interface';
import type { DrawDefinition, Participant, Tournament } from 'tods-competition-factory';
import { ACTIVE_SHARD_SYNC_SQL } from './physicalFootprintTrigger';
import { commandClient } from './commandTransaction';
import type { Pool } from 'pg';

export type { PhysicalFootprintRead, PhysicalFootprintRequest } from '../interfaces/tournament-storage.interface';

type Footprint = PhysicalFootprintRequest['footprint'];
type Scope = 'draw' | 'drawParticipants' | 'eventDraws';

function named(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0;
}

function scopeOf({ tournamentId, footprint, drawEventIds }: PhysicalFootprintRequest): Scope | undefined {
  if (
    !footprint ||
    !Array.isArray(footprint.shards) ||
    !Array.isArray(footprint.drawIds) ||
    !Array.isArray(footprint.eventIds)
  )
    return;
  const { tournament, shards, drawIds, eventIds, wholeRecordMethods } = footprint;
  if (!named(tournamentId) || tournament !== false || wholeRecordMethods?.length || !drawIds.length) return;
  if (!drawIds.every(named) || new Set(drawIds).size !== drawIds.length) return;
  if (Object.entries(drawEventIds ?? {}).some(([draw, event]) => !drawIds.includes(draw) || !named(event))) return;
  // Match the exact supported shapes. An unknown or broader requirement must reach the existing full reader.
  const exactly = (...expected: Footprint['shards']) =>
    expected.length === shards.length && expected.every((shard) => shards.includes(shard));
  if (eventIds.length === 0) {
    if (exactly('shell', 'draw')) return 'draw';
    if (exactly('shell', 'draw', 'drawParticipants')) return 'drawParticipants';
  }
  if (
    exactly('shell', 'draw', 'eventDraws', 'participants') &&
    eventIds.length === 1 &&
    named(eventIds[0]) &&
    drawIds.length === 1
  )
    return Object.values(drawEventIds ?? {}).every((id) => id === eventIds[0]) ? 'eventDraws' : undefined;
  return undefined;
}

/** Plan eligibility only. Layout, trigger, physical membership and revision are checked during the read. */
export function supportsPhysicalFootprint(request: PhysicalFootprintRequest): boolean {
  return scopeOf(request) !== undefined;
}

interface DrawRow {
  event_id: string;
  event_ord: number;
  draw_id: string;
  ord: number;
  draw: DrawDefinition;
  ambiguous?: boolean;
}

interface ParticipantRow {
  ord: number;
  participant_id: string;
  participant: Participant;
}

interface PhysicalRow {
  shell: Tournament;
  draws: DrawRow[];
  roster: ParticipantRow[] | null;
  parent_revision: string | null;
  updated_at: Date | string | null;
}

// Look up the target across the tournament BEFORE applying its claimed event binding. The physical event
// is every row of (tournament_id, event_ord), including any sibling with a missing or inconsistent label.
const eventOrdinal = `(SELECT min(anchor.event_ord)
   FROM draw_definitions anchor
  WHERE anchor.tournament_id = t.tournament_id AND anchor.draw_id = ANY($2::text[])
 HAVING count(*) = 1 AND min(anchor.event_id) = $3)`;

// A sibling's ID must also resolve uniquely when the factory looks it up across events.
// This probes the draw_id index without selecting any other draw's JSON.
const siblingAmbiguity = `EXISTS (SELECT 1 FROM draw_definitions other
  WHERE other.tournament_id = selected.tournament_id AND other.draw_id = selected.draw_id
    AND other.event_ord <> selected.event_ord) AS ambiguous`;

const roster = `(SELECT json_agg(p ORDER BY p.ord) FROM (
  SELECT ord, participant_id, participant FROM tournament_participants WHERE tournament_id = t.tournament_id
) p)`;

function selectParts(scope: Scope) {
  const event = scope === 'eventDraws';
  return `SELECT s.shell, t.updated_at,
                 t.xmin::text || '/' || extract(epoch FROM t.updated_at)::text AS parent_revision,
                 parts.draws, ${scope === 'draw' ? 'NULL' : roster} AS roster
            FROM tournaments t
            JOIN tournament_storage_layout l ON l.tournament_id = t.tournament_id AND l.layout = 'sharded'
            JOIN tournament_shells s ON s.tournament_id = t.tournament_id
            CROSS JOIN LATERAL (
              SELECT json_agg(d ORDER BY d.event_ord, d.ord) AS draws FROM (
                SELECT event_id, event_ord, draw_id, ord, draw ${event ? ', ' + siblingAmbiguity : ''}
                  FROM draw_definitions selected
                 WHERE tournament_id = t.tournament_id
                   AND ${event ? 'event_ord = ' + eventOrdinal : 'draw_id = ANY($2::text[])'}
              ) d HAVING count(*) > 0
            ) parts
           WHERE t.tournament_id = $1
             AND ${ACTIVE_SHARD_SYNC_SQL}`;
}

function emptyShard(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

function installDraws(record: Tournament, rows: DrawRow[], request: PhysicalFootprintRequest, scope: Scope): boolean {
  const { events } = record;
  if (!Array.isArray(events) || events.some((e) => !named(e?.eventId) || !emptyShard(e.drawDefinitions))) return false;
  if (new Set(events.map((e) => e.eventId)).size !== events.length) return false;

  const seen = new Set<string>();
  for (const { draw_id, event_id, event_ord, draw, ord, ambiguous } of rows) {
    const event = events[event_ord];
    if (ambiguous || !named(draw_id) || seen.has(draw_id) || draw?.drawId !== draw_id || ord < 0) return false;
    if (!event || event.eventId !== event_id || !Array.isArray(event.drawDefinitions)) return false;
    if (
      request.drawEventIds &&
      Object.prototype.hasOwnProperty.call(request.drawEventIds, draw_id) &&
      request.drawEventIds[draw_id] !== event_id
    )
      return false;
    if (scope === 'eventDraws' && (event_id !== request.footprint.eventIds[0] || ord !== event.drawDefinitions.length))
      return false;
    seen.add(draw_id);
    event.drawDefinitions.push(draw);
  }
  return request.footprint.drawIds.every((id) => seen.has(id));
}

function installRoster(record: Tournament, rows: ParticipantRow[], scope: Scope): boolean {
  if (rows.length && !Array.isArray(record.participants)) return false;
  const ids = new Set<string>();
  const participants: Participant[] = [];
  for (const { ord, participant_id, participant } of rows) {
    if (
      ord !== participants.length ||
      !named(participant_id) ||
      participant?.participantId !== participant_id ||
      ids.has(participant_id)
    )
      return false;
    ids.add(participant_id);
    participants.push(participant);
  }
  for (const { individualParticipantIds: members } of participants) {
    if (members !== undefined && (!Array.isArray(members) || members.some((id) => !ids.has(id)))) return false;
  }
  if (scope !== 'draw') {
    // These explicit links can disprove roster completeness. The complete physical roster supplies
    // the rest (including references in extension values/keys); do not infer a closure from entries.
    const hasEntries = (element: { entries?: { participantId?: string }[] }) =>
      element.entries === undefined ||
      (Array.isArray(element.entries) && element.entries.every((entry) => ids.has(entry?.participantId ?? '')));
    if (!record.events?.every((event) => hasEntries(event) && (event.drawDefinitions ?? []).every(hasEntries)))
      return false;
  }
  // The factory's 'participants' projection preserves an absent roster; its draw-only reduction installs [].
  if (scope !== 'eventDraws' || record.participants !== undefined) record.participants = participants;
  return true;
}

/**
 * One uncached statement on the current command connection (or pool). Under migration 062 the transaction
 * that changes the parent also maintains the physical rows. There is no qualified draw-to-participant index:
 * for drawParticipants take the complete ordered roster, including pair/team members and reverse groupings.
 * The caller marks this exact object with loadedFootprint. Fallback means to run the ordinary full-record
 * path; database errors propagate. A parent revision can guard a later write only while the parent is authoritative.
 */
export async function readPhysicalFootprint(
  pool: Pool,
  request: PhysicalFootprintRequest,
): Promise<PhysicalFootprintRead> {
  const scope = scopeOf(request);
  if (!scope) return { kind: 'fallback', reason: 'unsupported-footprint' };
  const { tournamentId, footprint } = request;
  const args =
    scope === 'eventDraws'
      ? [tournamentId, footprint.drawIds, footprint.eventIds[0]]
      : [tournamentId, footprint.drawIds];
  const {
    rows: [row],
  } = await (commandClient(pool) ?? pool).query<PhysicalRow>(selectParts(scope), args);
  if (!row) return { kind: 'fallback', reason: 'missing-shards-or-layout' };

  const record = row.shell;
  if (
    record?.tournamentId !== tournamentId ||
    !row.parent_revision ||
    !row.updated_at ||
    !emptyShard(record.participants)
  )
    return { kind: 'fallback', reason: 'invalid-shards' };
  if (!installDraws(record, row.draws, request, scope) || !installRoster(record, row.roster ?? [], scope))
    return { kind: 'fallback', reason: 'invalid-shards' };
  return {
    kind: 'partial',
    tournamentRecord: record,
    loadedFootprint: {
      tournament: false,
      shards: scope === 'drawParticipants' ? ['shell', 'draw', 'participants'] : [...footprint.shards],
      drawIds: [...footprint.drawIds],
      eventIds: [...footprint.eventIds],
      wholeRecordMethods: [],
    },
    parentRevision: row.parent_revision,
    previousServerUpdatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}
