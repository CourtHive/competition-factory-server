import { defined } from '../../tests/helpers/defined';
import {
  readPhysicalFootprint,
  supportsPhysicalFootprint,
  type PhysicalFootprintRequest,
} from './physicalFootprintReader';
import { loadFetchedRecords } from '../../modules/factory/helpers/loadFetchedRecords';
import asyncGlobalState from '../../modules/factory/engines/asyncGlobalState';
import { queryEngine } from '../../modules/factory/engines/queryEngine';
import { mocksEngine, tools, type Tournament } from 'tods-competition-factory';
import { PostgresTournamentStorage } from './postgres-tournament.storage';
import { commandTransaction } from './commandTransaction';
import { markRecordRevision, recordRevision } from './recordRevision';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';

const drawPlan = (drawIds: string[]) =>
  tools.getMutationFootprint({
    methods: drawIds.map((drawId) => ({ method: 'setMatchUpFormat', params: { drawId } })),
  });
const scorePlan = (drawId: string) =>
  tools.getMutationFootprint({
    methods: [{ method: 'setMatchUpStatus', params: { drawId } }],
    outcomePipeline: 'v2',
  });
const actionPlan = (eventId: string, drawId: string) =>
  tools.getQueryFootprint({
    methods: [{ method: 'matchUpActions', params: { eventId, drawId } }],
  });
const fixture = (tournamentId: string) => ({
  tournamentId,
  participants: [
    { participantId: 'z' },
    { participantId: 'p' },
    { participantId: 'a', individualParticipantIds: ['p'] },
  ],
  events: [
    {
      eventId: 'first',
      drawDefinitions: [{ drawId: 'z', entries: [{ participantId: 'p' }] }, { drawId: 'b' }, { drawId: 'a' }],
    },
    { eventId: 'elsewhere', drawDefinitions: [{ drawId: 'q' }] },
  ],
});

function ask(
  call: { method: string; params: object },
  record: Tournament,
  guard?: PhysicalFootprintRequest['footprint'],
) {
  return asyncGlobalState.runWithInstanceState(() => {
    expect(loadFetchedRecords({ [record.tournamentId]: record })).toEqual({ success: true });
    if (guard) queryEngine.loadedFootprint(guard, record.tournamentId);
    return queryEngine[call.method](call.params);
  });
}

describe.skipIf(process.env.STORAGE_LAYOUT_DB_TESTS !== 'true')('physical footprint reads on PostgreSQL', () => {
  const schema = 'footprint_' + randomUUID().replace(/-/g, '');
  let pool: Pool;
  let storage: PostgresTournamentStorage;
  const read = (
    tournamentId: string,
    footprint: PhysicalFootprintRequest['footprint'],
    drawEventIds?: Record<string, string>,
  ) => readPhysicalFootprint(pool, { tournamentId, footprint, drawEventIds });
  const shard = (id: string) => pool.query("SELECT set_tournament_storage_layout($1, 'sharded')", [id]);
  const prepare = async (record: Tournament) => {
    expect((await storage.saveTournamentRecord({ tournamentRecord: record })).success).toBe(true);
    await shard(record.tournamentId);
  };
  const partial = async (...args: Parameters<typeof read>) => {
    const result = await read(...args);
    if (result.kind !== 'partial') throw new Error('Expected physical record, got ' + result.reason);
    return result;
  };

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER || process.env.USER,
      password: process.env.PG_PASSWORD || '',
      database: process.env.PG_DATABASE || 'courthive',
      options: `-c search_path=${schema}`,
    });
    await pool.query(`CREATE SCHEMA ${schema}`);
    for (const file of [
      'migrations/001-initial-schema.sql',
      'migrations/042-add-tournament-owner-epoch.sql',
      'migrations/061-tournament-storage-layout.sql',
      'migrations/062-tournament-shards.sql',
      '../../scripts/sharding/enable-record-sharding.sql',
    ]) {
      await pool.query(readFileSync(join(__dirname, file), 'utf8'));
    }
    storage = new PostgresTournamentStorage(pool);
  });
  afterAll(async () => {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
    }
  });

  it('selects requested draws in physical order and returns the full reader’s parent version and timestamp', async () => {
    const record = fixture('ordered');
    await prepare(record);
    const footprint = drawPlan(['a', 'z']);
    const actual = await partial(record.tournamentId, footprint, { a: 'first', z: 'first' });
    expect(actual.tournamentRecord).toEqual(tools.reduceRecordToFootprint({ tournamentRecord: record, footprint }));
    expect(actual.loadedFootprint).toEqual(footprint);
    const full = await storage.fetchTournamentRecords({ tournamentId: record.tournamentId, captureRevision: true });
    if (!('tournamentRecords' in full)) throw new Error('Missing whole-record oracle');
    const tokenCheck = {};
    markRecordRevision(tokenCheck, record.tournamentId, actual.parentRevision);
    expect(recordRevision(tokenCheck)).toBe(recordRevision(full.tournamentRecords![record.tournamentId]));
    expect(actual.previousServerUpdatedAt).toBe(full.serverUpdatedAt![record.tournamentId]);
  });

  it('reads every participant for drawParticipants, including reverse group memberships and unrelated participants', async () => {
    const record = fixture('scoring');
    await prepare(record);
    const actual = await partial(record.tournamentId, scorePlan('z'));
    expect(actual.loadedFootprint.shards).toEqual(['shell', 'draw', 'participants']);
    expect(actual.tournamentRecord.participants).toEqual(record.participants);
    expect(actual.tournamentRecord.events?.flatMap((e) => e.drawDefinitions)).toEqual([
      record.events[0].drawDefinitions[0],
    ]);
  });

  it('refuses unsupported footprints without issuing SQL', async () => {
    const query = vi.spyOn(pool, 'query');
    try {
      for (const fp of [
        drawPlan([]),
        { ...drawPlan(['z']), shards: ['shell'] as const },
        { ...actionPlan('first', 'z'), eventIds: ['first', 'elsewhere'] },
        { ...actionPlan('first', 'z'), drawIds: ['z', 'a'] },
      ]) {
        expect(await read('x', { ...fp, shards: [...fp.shards] })).toEqual({
          kind: 'fallback',
          reason: 'unsupported-footprint',
        });
      }
      expect(query).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
    }
  });

  it('draw-only SQL has no parent document or participant-table dependency', async () => {
    const record = fixture('physical-only');
    await prepare(record);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Hide the entire roster table, and capture the statement that PostgreSQL actually executed.
      await client.query('CREATE TEMP TABLE tournament_participants (forbidden int) ON COMMIT DROP');
      const statement = vi.spyOn(client, 'query');
      try {
        const result = await commandTransaction.run({ pool, client, afterCommit: [] }, () =>
          partial(record.tournamentId, drawPlan(['a'])),
        );
        expect(result.tournamentRecord.events![0].drawDefinitions).toEqual([{ drawId: 'a' }]);
        expect(statement).toHaveBeenCalledTimes(1);
        const [sql] = statement.mock.calls[0];
        expect(sql).not.toMatch(
          /t\.data|tournament_document|tournament_reassemble|tournament_participants|SELECT\s+\*/i,
        );
      } finally {
        statement.mockRestore();
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('can read each supported footprint without permission on the parent document', async (ctx) => {
    const {
      rows: [user],
    } = await pool.query('SELECT rolcreaterole OR rolsuper AS can_grant FROM pg_roles WHERE rolname=current_user');
    ctx.skip(!user.can_grant, 'requires a disposable reader role');
    const id = 'restricted-reader',
      role = schema + '_reader';
    await prepare(fixture(id));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE ROLE ${role}`);
      await client.query(`GRANT ${role} TO CURRENT_USER`);
      await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
      await client.query(`GRANT SELECT (tournament_id, updated_at, xmin, tableoid) ON tournaments TO ${role}`);
      await client.query(`GRANT SELECT ON tournament_storage_layout, tournament_shells, draw_definitions TO ${role}`);
      await client.query(`SET LOCAL ROLE ${role}`);
      const check = (fp: PhysicalFootprintRequest['footprint']) =>
        commandTransaction.run({ pool, client, afterCommit: [] }, () => partial(id, fp));
      const {
        rows: [permissions],
      } = await client.query(
        "SELECT has_column_privilege('tournaments','data','SELECT') AS parent, has_table_privilege('tournament_participants','SELECT') AS roster",
      );
      expect(permissions).toEqual({ parent: false, roster: false });
      await check(drawPlan(['z']));
      await client.query('RESET ROLE');
      await client.query(`GRANT SELECT ON tournament_participants TO ${role}`);
      await client.query(`SET LOCAL ROLE ${role}`);
      await check(scorePlan('z'));
      await check(actionPlan('first', 'z'));
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('distinguishes a supported plan from a usable sharded layout with an active origin trigger', async () => {
    const id = 'trigger-state',
      request = { tournamentId: id, footprint: drawPlan(['a']) };
    expect(supportsPhysicalFootprint(request)).toBe(true);
    expect(supportsPhysicalFootprint({ ...request, footprint: drawPlan([]) })).toBe(false);
    await prepare(fixture(id));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const check = () =>
        commandTransaction.run({ pool, client, afterCommit: [] }, () => readPhysicalFootprint(pool, request));
      for (const sql of [
        'ALTER TABLE tournaments DISABLE TRIGGER tournaments_shard_sync',
        'ALTER TABLE tournaments ENABLE REPLICA TRIGGER tournaments_shard_sync',
        'DROP TRIGGER tournaments_shard_sync ON tournaments',
      ]) {
        await client.query(sql);
        expect(await check()).toEqual({ kind: 'fallback', reason: 'missing-shards-or-layout' });
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect((await readPhysicalFootprint(pool, request)).kind).toBe('partial');
  });

  it('falls back on document layout, missing shell or draw, wrong binding and ambiguous draw membership', async () => {
    const record = fixture('fallback');
    const id = record.tournamentId;
    await storage.saveTournamentRecord({ tournamentRecord: record });
    expect((await read(id, drawPlan(['z']))).kind).toBe('fallback');
    await shard(id);
    for (const args of [
      [drawPlan(['z', 'missing'])],
      [drawPlan(['z']), { z: 'elsewhere' }],
      [actionPlan('elsewhere', 'z')],
      [actionPlan('first', 'z'), { z: 'elsewhere' }],
    ] as const)
      expect((await read(id, args[0], args[1])).kind).toBe('fallback');
    record.events[1].drawDefinitions.push({ drawId: 'a' });
    await storage.saveTournamentRecord({ tournamentRecord: record });
    expect((await read(id, drawPlan(['a']), { a: 'first' })).kind).toBe('fallback');
    expect((await read(id, actionPlan('first', 'z'))).kind).toBe('fallback'); // ambiguous sibling
    await pool.query('DELETE FROM tournament_shells WHERE tournament_id=$1', [id]);
    expect((await read(id, drawPlan(['z']))).kind).toBe('fallback');
  });

  it.each([
    ["UPDATE draw_definitions SET event_id='other' WHERE tournament_id=$1 AND draw_id='a'", 'event binding'],
    ["UPDATE draw_definitions SET ord=9 WHERE tournament_id=$1 AND draw_id='a'", 'draw ordinal gap'],
    [
      "UPDATE draw_definitions SET draw_id='other' WHERE tournament_id=$1 AND draw_id='a'",
      'draw ID disagrees with JSON',
    ],
    [
      "UPDATE tournament_shells SET shell=jsonb_set(shell,'{events,1,eventId}','\"first\"') WHERE tournament_id=$1",
      'duplicate event',
    ],
    ['DELETE FROM tournament_participants WHERE tournament_id=$1 AND ord=1', 'roster ordinal gap'],
    ['DELETE FROM tournament_participants WHERE tournament_id=$1', 'draw entry references a missing participant'],
    [
      "UPDATE tournament_participants SET participant_id='wrong' WHERE tournament_id=$1 AND ord=1",
      'participant identity',
    ],
    [
      "UPDATE tournament_participants SET participant_id='p', participant=jsonb_set(participant,'{participantId}','\"p\"') WHERE tournament_id=$1 AND ord=0",
      'ambiguous participant',
    ],
    [
      "UPDATE tournament_participants SET participant=jsonb_set(participant,'{individualParticipantIds}','[\"absent\"]') WHERE tournament_id=$1 AND ord=2",
      'missing group member',
    ],
  ])('refuses inconsistent physical membership (%s, %s)', async (sql, label) => {
    const record = fixture(label);
    await prepare(record);
    await pool.query(sql, [label]);
    expect((await read(label, actionPlan('first', 'z'))).kind).toBe('fallback');
  });

  it('observes own writes on the command client, hides uncommitted writes from peers, and changes tokens on equal-time commits', async () => {
    const record = fixture('peer');
    await prepare(record);
    const id = record.tournamentId,
      fp = actionPlan('first', 'z');
    const before = await partial(id, fp);
    const next = structuredClone(record);
    next.events[0].drawDefinitions.reverse();
    next.participants.reverse();
    Object.assign(next, { tournamentName: 'new' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE tournaments SET data=$2 WHERE tournament_id=$1', [id, next]);
      const pending = await commandTransaction.run({ pool, client, afterCommit: [] }, () => partial(id, fp));
      const expected = tools.reduceRecordToFootprint({ tournamentRecord: next, footprint: fp });
      expect(pending.tournamentRecord).toEqual(expected);
      expect(await partial(id, fp)).toEqual(before);
      await client.query('ROLLBACK');
      expect(await partial(id, fp)).toEqual(before);
      await client.query('UPDATE tournaments SET data=$2 WHERE tournament_id=$1', [id, next]);
      const committed = await partial(id, fp);
      expect(committed.tournamentRecord).toEqual(expected);
      expect(committed.previousServerUpdatedAt).toBe(before.previousServerUpdatedAt);
      expect(committed.parentRevision).not.toBe(before.parentRevision);
      expect(committed.parentRevision).not.toBe(pending.parentRevision);
    } finally {
      client.release();
    }
  });

  it('keeps one MVCC snapshot when a parent and its shards commit while the statement is reading', async () => {
    const record = fixture('during-read');
    await prepare(record);
    const fp = actionPlan('first', 'z');
    const before = await partial(record.tournamentId, fp);
    const reader = await pool.connect(),
      writer = await pool.connect();
    let reading: ReturnType<typeof partial> | undefined;
    try {
      const {
        rows: [{ pid }],
      } = await reader.query('SELECT pg_backend_pid() AS pid');
      await reader.query('BEGIN');
      // This test-only view pauses the real SELECT after PostgreSQL has established its statement snapshot.
      // The writer uses the actual table. No timing assumption determines when the writer may commit.
      await reader.query(`CREATE TEMP VIEW tournament_shells AS
        SELECT s.* FROM ${schema}.tournament_shells s CROSS JOIN (SELECT pg_advisory_xact_lock(${pid}, 1)) gate`);
      await writer.query('BEGIN');
      await writer.query('SELECT pg_advisory_xact_lock($1,1)', [pid]);
      reading = commandTransaction.run({ pool, client: reader, afterCommit: [] }, () =>
        partial(record.tournamentId, fp),
      );
      // Keep errors observed even if the statement fails before reaching the lock.
      await Promise.race([reading, waitForBlocker()]);
      async function waitForBlocker() {
        for (let i = 0; i < 500; i++) {
          const {
            rows: [{ blocked }],
          } = await writer.query('SELECT pg_backend_pid() = ANY(pg_blocking_pids($1)) AS blocked', [pid]);
          if (blocked) return;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error('reader did not reach the snapshot barrier');
      }
      const {
        rows: [{ blocked }],
      } = await writer.query('SELECT pg_backend_pid() = ANY(pg_blocking_pids($1)) AS blocked', [pid]);
      expect(blocked).toBe(true);
      const newer = {
        ...record,
        tournamentName: 'committed',
        participants: [...record.participants].reverse(),
        events: [
          { ...record.events[0], drawDefinitions: [...record.events[0].drawDefinitions].reverse() },
          record.events[1],
        ],
      };
      await writer.query('UPDATE tournaments SET data=$2, updated_at=clock_timestamp() WHERE tournament_id=$1', [
        record.tournamentId,
        newer,
      ]);
      await writer.query('COMMIT');
      expect(await reading).toEqual(before);
      const after = await partial(record.tournamentId, fp);
      expect(after.tournamentRecord).toEqual(tools.reduceRecordToFootprint({ tournamentRecord: newer, footprint: fp }));
      expect(after.parentRevision).not.toBe(before.parentRevision);
    } finally {
      await writer.query('ROLLBACK');
      await reading?.catch(() => undefined);
      await reader.query('ROLLBACK');
      reader.release();
      writer.release();
    }
  });

  it.each(['SINGLES', 'DOUBLES', 'TEAM'])(
    'returns whole-record action results under the published guard for %s',
    async (eventType) => {
      const record = asyncGlobalState.runWithInstanceState(
        () =>
          mocksEngine.generateTournamentRecord({
            nonRandom: 23981,
            tournamentAttributes: { tournamentId: 'actions-' + eventType },
            participantsProfile: { participantsCount: 80 },
            eventProfiles: [
              {
                eventId: 'E1',
                eventType,
                drawProfiles: [
                  { drawId: 'D1', drawSize: 8 },
                  { drawId: 'D2', drawSize: 8 },
                ],
              },
              { eventId: 'E2', drawProfiles: [{ drawId: 'D3', drawSize: 8 }] },
            ],
          }).tournamentRecord,
      );
      await prepare(record);
      const draw = defined(defined(record.events)[0].drawDefinitions)[0],
        structure = defined(draw.structures)[0];
      const match = defined(defined(structure.matchUps).find((m) => m.roundNumber === 1));
      for (const call of [
        { method: 'matchUpActions', params: { eventId: 'E1', drawId: 'D1', matchUpId: match.matchUpId } },
        {
          method: 'positionActions',
          params: {
            eventId: 'E1',
            drawId: 'D1',
            structureId: structure.structureId,
            drawPosition: 1,
            returnParticipants: true,
          },
        },
      ]) {
        const fp = tools.getQueryFootprint({ methods: [call] });
        const actual = await partial(record.tournamentId, fp);

        const full = (await storage.findTournamentRecord({ tournamentId: record.tournamentId })).tournamentRecord;
        expect(actual.tournamentRecord).toEqual(
          tools.reduceRecordToFootprint({ tournamentRecord: full, footprint: fp }),
        );
        const expected = ask(call, full);
        expect(expected.error).toBeUndefined();
        expect(ask(call, actual.tournamentRecord, actual.loadedFootprint)).toEqual(expected);
        expect(
          ask(call, actual.tournamentRecord, { ...fp, shards: ['shell', 'draw', 'participants'] }).error.code,
        ).toBe('ERR_FOOTPRINT_NOT_LOADED');
      }
    },
  );

  it.skipIf(!process.env.PHYSICAL_FOOTPRINT_CORPUS_DIR)(
    'reproduces the model corpus on its two largest draws per retained tournament',
    async () => {
      const dir = process.env.PHYSICAL_FOOTPRINT_CORPUS_DIR!;
      const tested = new Set<string>();
      for (const file of readdirSync(dir)
        .filter((f) => /^non-ita-.*\.jsonl$/.test(f))
        .sort()) {
        for (const line of readFileSync(join(dir, file), 'utf8').trimEnd().split('\n')) {
          if (Buffer.byteLength(line) <= 2 ** 20) continue;
          const { record } = JSON.parse(line);
          if (
            tested.has(record.tournamentId) ||
            !record.parentOrganisation?.organisationId ||
            Buffer.byteLength(JSON.stringify(record)) <= 2 ** 20
          )
            continue;
          const targets = record.events
            .flatMap((e) =>
              (e.drawDefinitions ?? [])
                .filter((d) => d.drawId && e.eventId)
                .map((d) => ({
                  eventId: e.eventId,
                  drawId: d.drawId,
                  bytes: Buffer.byteLength(JSON.stringify(d)),
                })),
            )
            .sort((a, b) => b.bytes - a.bytes)
            .slice(0, 2);
          if (targets.length !== 2) continue;
          await prepare(record);
          for (const { eventId, drawId } of targets) {
            for (const fp of [drawPlan([drawId]), scorePlan(drawId), actionPlan(eventId, drawId)]) {
              const result = await partial(record.tournamentId, fp, { [drawId]: eventId });
              const oracle = tools.reduceRecordToFootprint({
                tournamentRecord: record,
                footprint: result.loadedFootprint,
              });
              expect(result.tournamentRecord).toEqual(oracle);
              if (fp.shards.includes('eventDraws')) {
                const draw = record.events
                  .find((e) => e.eventId === eventId)
                  .drawDefinitions.find((d) => d.drawId === drawId);
                const structure = draw.structures.find((s) => s.matchUps?.some((m) => m.matchUpId));
                const match = structure.matchUps.find((m) => m.matchUpId);
                for (const call of [
                  { method: 'matchUpActions', params: { eventId, drawId, matchUpId: match.matchUpId } },
                  {
                    method: 'positionActions',
                    params: {
                      eventId,
                      drawId,
                      structureId: structure.structureId,
                      drawPosition: 1,
                      returnParticipants: true,
                    },
                  },
                ]) {
                  const expected = ask(call, record);
                  expect(expected.error).toBeUndefined();
                  expect(ask(call, result.tournamentRecord, result.loadedFootprint)).toEqual(expected);
                }
              }
            }
          }
          tested.add(record.tournamentId);
        }
      }
      expect(tested.size).toBe(15);
    },
    120_000,
  );
});
