import type { PhysicalFootprintRead, PhysicalFootprintRequest } from '../interfaces/tournament-storage.interface';
import type { DrawDefinition, Participant, Tournament } from 'tods-competition-factory';
import { ACTIVE_SHARD_CACHE_REVISIONS_SQL } from './shardCacheRevisionGuard';
import { ACTIVE_SHARD_SYNC_SQL } from './physicalFootprintTrigger';
import { commandClient, commandTransaction } from './commandTransaction';
import {
  drawBodyKey,
  type ShardBodyCache,
  type ShardBodyHandle,
  type ShardBodyLocation,
  type ShardBodySnapshot,
} from './shardBodyCache';
import { shardCacheReadObserver } from './shardCacheObservation';
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
const eventOrdinal = (eventParam: string) => `(SELECT min(anchor.event_ord)
   FROM draw_definitions anchor
  WHERE anchor.tournament_id = t.tournament_id AND anchor.draw_id = ANY($2::text[])
 HAVING count(*) = 1 AND min(anchor.event_id) = ${eventParam})`;

// A sibling's ID must also resolve uniquely when the factory looks it up across events.
// This probes the draw_id index without selecting any other draw's JSON.
const siblingAmbiguity = `EXISTS (SELECT 1 FROM draw_definitions other
  WHERE other.tournament_id = selected.tournament_id AND other.draw_id = selected.draw_id
    AND other.event_ord <> selected.event_ord) AS ambiguous`;

const roster = `(SELECT json_agg(p ORDER BY p.ord) FROM (
  SELECT ord, participant_id, participant FROM tournament_participants WHERE tournament_id = t.tournament_id
) p)`;

// A hit returns only its physical ordinal. The UUID covers the complete row (including its
// indexed identity). The array of live rows is still selected and ordered on every request.
const conditionalRoster = `(SELECT json_agg(
  CASE WHEN revisions.active AND p.cache_revision = hints.token THEN to_json(p.ord) ELSE json_build_object(
    'ord', p.ord, 'participant_id', p.participant_id, 'token', CASE WHEN revisions.active THEN p.cache_revision END, 'body', p.participant::text
  ) END ORDER BY p.ord)
  FROM tournament_participants p
  LEFT JOIN unnest($5::int[], $6::uuid[]) hints(ord, token) ON hints.ord = p.ord
  WHERE p.tournament_id = t.tournament_id)`;

const conditionalShell = `CASE WHEN revisions.active THEN s.cache_revision::text END AS shell_token,
                 CASE WHEN revisions.active AND s.cache_revision = $3::uuid THEN NULL ELSE s.shell::text END AS shell_body`;
const conditionalDraw = `CASE WHEN revisions.active THEN selected.cache_revision END AS token,
                       CASE WHEN revisions.active AND selected.cache_revision::text = ($4::jsonb ->> (event_ord::text || '/' || ord::text))
                            THEN NULL ELSE draw::text END AS body`;

// Check revision authority once, even for a collection of thousands of rows. If a trigger is
// inactive all bodies cross the wire and every admission token is NULL. This also makes a session
// with an outstanding write ineligible if it escaped the normal command-transaction entry point.
const revisionGate = `/* conditional physical footprint */ WITH revision_gate AS MATERIALIZED (
  SELECT ${ACTIVE_SHARD_CACHE_REVISIONS_SQL} AND pg_current_xact_id_if_assigned() IS NULL AS active
) `;

const coldRosterJoin = ` CROSS JOIN LATERAL (
              SELECT json_agg(json_build_object('ord', p.ord, 'participant_id', p.participant_id,
                         'token', CASE WHEN revisions.active THEN p.cache_revision END) ORDER BY p.ord) AS roster,
                     string_agg(p.participant::text, chr(30) ORDER BY p.ord) AS participant_bodies
                FROM tournament_participants p WHERE p.tournament_id = t.tournament_id
            ) people`;

// Empty hints make every row a miss. Transfer body text separately from its metadata so PostgreSQL
// does not quote each body as a nested JSON string. Both aggregates use the same physical key order.
const coldDraws = `SELECT json_agg(json_build_object('event_id', event_id, 'event_ord', event_ord, 'draw_id', draw_id,
                        'ord', ord, 'token', token, 'ambiguous', ambiguous) ORDER BY event_ord, ord) AS draws,
                     string_agg(draw::text, chr(30) ORDER BY event_ord, ord) AS draw_bodies`;

type ReadMode = 'plain' | 'hinted' | 'cold';

function selectParts(scope: Scope, mode: ReadMode = 'plain') {
  const event = scope === 'eventDraws';
  const cold = mode === 'cold';
  const conditional = mode !== 'plain';
  const shell = cold
    ? 'CASE WHEN revisions.active THEN s.cache_revision::text END AS shell_token, s.shell::text AS shell_body'
    : conditional
      ? conditionalShell
      : 's.shell';
  const selectedRoster = scope === 'draw' ? 'NULL' : conditional ? conditionalRoster : roster;
  const collections = cold
    ? `parts.draws, parts.draw_bodies, ${scope === 'draw' ? 'NULL AS roster, NULL::text AS participant_bodies' : 'people.roster, people.participant_bodies'}`
    : `parts.draws, ${selectedRoster} AS roster`;
  const drawColumns = cold
    ? `draw, CASE WHEN revisions.active THEN selected.cache_revision END AS token, ${event ? siblingAmbiguity : 'false AS ambiguous'}`
    : `${conditional ? conditionalDraw : 'draw'} ${event ? ', ' + siblingAmbiguity : ''}`;
  return `${conditional ? revisionGate : ''}SELECT ${shell}, t.updated_at,
                 t.xmin::text || '/' || extract(epoch FROM t.updated_at)::text AS parent_revision,
                 ${collections}
            FROM tournaments t
            JOIN tournament_storage_layout l ON l.tournament_id = t.tournament_id AND l.layout = 'sharded'
            JOIN tournament_shells s ON s.tournament_id = t.tournament_id${conditional ? ' CROSS JOIN revision_gate revisions' : ''}
            CROSS JOIN LATERAL (
              ${cold ? coldDraws : 'SELECT json_agg(d ORDER BY d.event_ord, d.ord) AS draws'} FROM (
                SELECT event_id, event_ord, draw_id, ord, ${drawColumns}
                  FROM draw_definitions selected
                 WHERE tournament_id = t.tournament_id
                   AND ${event ? 'event_ord = ' + eventOrdinal(mode === 'hinted' ? '$7' : '$3') : 'draw_id = ANY($2::text[])'}
              ) d HAVING count(*) > 0
            ) parts${cold && scope !== 'draw' ? coldRosterJoin : ''}
           WHERE t.tournament_id = $1
             AND ${ACTIVE_SHARD_SYNC_SQL}${conditional ? ' AND NOT pg_catalog.pg_is_in_recovery()' : ''}`;
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

function assemble(
  row: PhysicalRow | undefined,
  request: PhysicalFootprintRequest,
  scope: Scope,
): PhysicalFootprintRead {
  const { tournamentId, footprint } = request;
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

interface WireBody {
  token: string | null;
  body: string | null;
}

interface ConditionalRow extends Pick<PhysicalRow, 'updated_at' | 'parent_revision'> {
  shell_token: string | null;
  shell_body: string | null;
  draws: (Omit<DrawRow, 'draw'> & WireBody)[];
  roster: (number | (Omit<ParticipantRow, 'participant'> & WireBody))[] | null;
}

function hintArgs(request: PhysicalFootprintRequest, scope: Scope, snapshot: ShardBodySnapshot): unknown[] {
  const drawTokens: Record<string, string> = {};
  for (const [key, handle] of snapshot.draws) drawTokens[key] = handle.token;
  const args: unknown[] = [request.tournamentId, request.footprint.drawIds, snapshot.shell?.token ?? null, drawTokens];
  if (scope !== 'draw') {
    const ordinals: number[] = [],
      tokens: string[] = [];
    for (const [ord, handle] of snapshot.participants) {
      ordinals.push(ord);
      tokens.push(handle.token);
    }
    args.push(ordinals, tokens);
  }
  if (scope === 'eventDraws') args.push(request.footprint.eventIds[0]);
  return args;
}

// JSONB text escapes U+001E in strings and its emitted whitespace cannot contain U+001E.
// The separator therefore identifies boundaries even when original user data contains that character.
function attachColdBodies(rows: (WireBody | number)[] | null, text: string | null) {
  const bodies = text === null ? [] : text.split('\u001e');
  if (bodies.length !== (rows?.length ?? 0)) throw new Error('Mismatched physical body count');
  rows?.forEach((row, index) => {
    if (typeof row === 'number') throw new Error('Unexpected physical hit on cold read');
    row.body = bodies[index];
  });
}

async function selectConditionalRow(
  pool: Pool,
  request: PhysicalFootprintRequest,
  scope: Scope,
  snapshot: ShardBodySnapshot,
): Promise<ConditionalRow | undefined> {
  if (snapshot.shell || snapshot.draws.size || snapshot.participants.size) {
    const result = await pool.query<ConditionalRow>(selectParts(scope, 'hinted'), hintArgs(request, scope, snapshot));
    return result.rows[0];
  }
  const args = [request.tournamentId, request.footprint.drawIds];
  if (scope === 'eventDraws') args.push(request.footprint.eventIds[0]);
  const result = await pool.query<ConditionalRow & { draw_bodies: string; participant_bodies: string | null }>(
    selectParts(scope, 'cold'),
    args,
  );
  const row = result.rows[0];
  if (row) {
    attachColdBodies(row.draws, row.draw_bodies);
    attachColdBodies(row.roster, row.participant_bodies);
  }
  return row;
}

async function conditionalRead(
  pool: Pool,
  request: PhysicalFootprintRequest,
  scope: Scope,
  cache: ShardBodyCache,
): Promise<PhysicalFootprintRead> {
  const { tournamentId, footprint } = request;
  const snapshot = cache.snapshot(tournamentId, footprint.drawIds, footprint.eventIds[0], scope !== 'draw');
  const pending: { location: ShardBodyLocation; token: string; text: string }[] = [];
  const hits = { shell: 0, draw: 0, participant: 0 },
    loaded = { shell: 0, draw: 0, participant: 0 };
  function decode<T>(
    text: string | null,
    token: string | null,
    location: ShardBodyLocation,
    handle?: ShardBodyHandle,
  ): T {
    if (text === null) {
      if (!handle || handle.token !== token)
        throw new Error('Physical shard hit without its validated snapshot handle');
      hits[location.kind]++;
      return handle.parse<T>();
    }
    loaded[location.kind]++;
    if (token !== null) pending.push({ location, token, text });
    return JSON.parse(text);
  }

  let result: PhysicalFootprintRead;
  const observe = shardCacheReadObserver(pool);
  try {
    const row = await selectConditionalRow(pool, request, scope, snapshot);
    if (!row) return { kind: 'fallback', reason: 'missing-shards-or-layout' };
    const shell = decode<Tournament>(row.shell_body, row.shell_token, { kind: 'shell' }, snapshot.shell);
    const draws = row.draws.map((d) => {
      const location: ShardBodyLocation = {
        kind: 'draw',
        eventOrd: d.event_ord,
        ord: d.ord,
        eventId: d.event_id,
        drawId: d.draw_id,
      };
      const draw = decode<DrawDefinition>(
        d.body,
        d.token,
        location,
        snapshot.draws.get(drawBodyKey(d.event_ord, d.ord)),
      );
      return {
        event_id: d.event_id,
        event_ord: d.event_ord,
        draw_id: d.draw_id,
        ord: d.ord,
        ambiguous: d.ambiguous,
        draw,
      };
    });
    const roster =
      row.roster?.map((p) => {
        if (typeof p === 'number') {
          const handle = snapshot.participants.get(p);
          if (!handle) throw new Error('Physical participant hit without its validated snapshot handle');
          const participant = handle.parse<Participant>();
          hits.participant++;
          return { ord: p, participant_id: participant.participantId, participant };
        }
        return {
          ord: p.ord,
          participant_id: p.participant_id,
          participant: decode<Participant>(p.body, p.token, { kind: 'participant', ord: p.ord }),
        };
      }) ?? null;
    result = assemble(
      { shell, draws, roster, updated_at: row.updated_at, parent_revision: row.parent_revision },
      request,
      scope,
    );
  } finally {
    snapshot.release();
  }
  if (result.kind === 'partial') {
    // Keep the original row text. The assembled shell now also points at other rows.
    for (const { location, token, text } of pending) cache.put(tournamentId, location, token, text);
    observe?.(hits, loaded);
  }
  return result;
}

/**
 * One primary statement owns the layout, binding, membership, versions and bodies. The command
 * connection uses the plain SELECT so uncommitted data can never enter or hit the shared LRU.
 * The caller marks the returned private object and owns whole-record fallback and persistence.
 */
export async function readPhysicalFootprint(
  pool: Pool,
  request: PhysicalFootprintRequest,
  cache?: ShardBodyCache,
): Promise<PhysicalFootprintRead> {
  const scope = scopeOf(request);
  if (!scope) return { kind: 'fallback', reason: 'unsupported-footprint' };
  if (cache?.enabled && !commandTransaction.getStore()) return conditionalRead(pool, request, scope, cache);
  const { tournamentId, footprint } = request;
  const args =
    scope === 'eventDraws'
      ? [tournamentId, footprint.drawIds, footprint.eventIds[0]]
      : [tournamentId, footprint.drawIds];
  const {
    rows: [row],
  } = await (commandClient(pool) ?? pool).query<PhysicalRow>(selectParts(scope), args);
  return assemble(row, request, scope);
}
