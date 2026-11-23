import type { PhysicalFootprintReader } from '../interfaces/tournament-storage.interface';
import { PostgresTournamentStorage } from './postgres-tournament.storage';
import { readPhysicalFootprint } from './physicalFootprintReader';
import { measureShardCache } from './shardCacheObservation';
import { commandTransaction } from './commandTransaction';
import { tools } from 'tods-competition-factory';
import { recordRevision } from './recordRevision';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';

const fixture = (tournamentId: string, version = 'before') => ({
  tournamentId,
  tournamentName: 'shell-body-' + version,
  events: [
    {
      eventId: 'event',
      drawDefinitions: [
        { drawId: 'a', drawName: 'draw-a-body-' + version, entries: [{ participantId: 'p' }] },
        { drawId: 'b', drawName: 'draw-b-body-' + version },
      ],
    },
  ],
  participants: [
    { participantId: 'p', participantName: 'player-p-body-' + version },
    { participantId: 'q', participantName: 'player-q-body-' + version },
  ],
});

type RecordFixture = ReturnType<typeof fixture>;
const all = {
  footprint: tools.getQueryFootprint({
    methods: [{ method: 'matchUpActions', params: { eventId: 'event', drawId: 'a' } }],
  }),
};
const draw = (drawId: string) => ({
  footprint: tools.getMutationFootprint({
    methods: [{ method: 'setMatchUpFormat', params: { drawId } }],
  }),
});

function adapter(pool: Pool, allowlist: string, bytes: number) {
  try {
    vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_READS', 'true');
    vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_TOURNAMENT_IDS', allowlist);
    vi.stubEnv('CFS_SHARD_CACHE_BYTES', String(bytes));
    return new PostgresTournamentStorage(pool);
  } finally {
    vi.unstubAllEnvs();
  }
}

async function partial(read: PhysicalFootprintReader, request = all) {
  const result = await read(request);
  if (result.kind !== 'partial') throw new Error('Expected physical read, got ' + result.reason);
  return result;
}

// Observe pg's actual result before the assembler can mutate the shell. The marker strings are values
// inside individual JSON bodies; row identities and SQL parameters never contain them.
async function traceRead(pool: Pool, read: PhysicalFootprintReader, request = all) {
  const query = pool.query.bind(pool);
  const statements: Array<{ sql: string; wire: string }> = [];
  const spy = vi.spyOn(pool, 'query').mockImplementation((async (sql: string, values: unknown[]) => {
    const response = await query(sql, values);
    statements.push({ sql, wire: JSON.stringify(response.rows) });
    return response;
  }) as Pool['query']);
  try {
    const result = await read(request);
    expect(statements).toHaveLength(1);
    return { result, ...statements[0] };
  } finally {
    spy.mockRestore();
  }
}

async function observed(pool: Pool, read: PhysicalFootprintReader, request = all) {
  const { result, sql, wire } = await traceRead(pool, read, request);
  if (result.kind !== 'partial') throw new Error('Expected physical read, got ' + result.reason);
  return { ...result, sql, wire };
}

const bodyNames = (r: RecordFixture) => [
  r.tournamentName,
  ...r.events[0].drawDefinitions.map((d) => d.drawName),
  ...r.participants.map((p) => p.participantName),
];

function expectTransferred(wire: string, record: RecordFixture, expected: string[]) {
  expect(bodyNames(record).filter((value) => wire.includes(value))).toEqual(expected);
}

describe.skipIf(process.env.STORAGE_LAYOUT_DB_TESTS !== 'true')(
  'worker-local shard body retention on PostgreSQL',
  () => {
    const schema = 'warm_' + randomUUID().replace(/-/g, '');
    let pool: Pool;
    let peer: Pool;

    beforeAll(async () => {
      const config = {
        host: process.env.PG_HOST || 'localhost',
        port: Number(process.env.PG_PORT) || 5432,
        user: process.env.PG_USER || process.env.USER,
        password: process.env.PG_PASSWORD || '',
        database: process.env.PG_DATABASE || 'courthive',
        options: '-c search_path=' + schema,
      };
      pool = new Pool(config);
      peer = new Pool(config);
      await pool.query('CREATE SCHEMA ' + schema);
      for (const file of [
        'migrations/001-initial-schema.sql',
        'migrations/042-add-tournament-owner-epoch.sql',
        'migrations/061-tournament-storage-layout.sql',
        'migrations/062-tournament-shards.sql',
        '../../scripts/sharding/enable-record-sharding.sql',
      ])
        await pool.query(readFileSync(join(__dirname, file), 'utf8'));
      // Both pre-067 tournaments receive the same fast-default token per table at migration.
      await setup('pre-067', 0);
      await setup('pre-067-peer', 0, fixture('pre-067-peer', 'different-record'));
      await pool.query(readFileSync(join(__dirname, 'migrations/067-shard-cache-revisions.sql'), 'utf8'));
    });

    afterAll(async () => {
      try {
        await pool.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
      } finally {
        await Promise.all([pool.end(), peer.end()]);
      }
    });

    const layout = (id: string, value: 'document' | 'sharded') =>
      peer.query('SELECT set_tournament_storage_layout($1, $2)', [id, value]);

    async function setup(id: string, bytes = 1_000_000, record = fixture(id)) {
      const storage = adapter(pool, id, bytes);
      expect(storage.readerForTournament('unlisted')).toBeUndefined();
      const read = storage.readerForTournament(id)!;
      expect(read).toBeTypeOf('function');
      expect(await storage.saveTournamentRecord({ tournamentRecord: record })).toMatchObject({ success: true });
      await layout(id, 'sharded');
      return { storage, read, record };
    }

    // A peer writes the authoritative document. Leaving updated_at untouched exercises both 062's
    // transactional shard sync and revision changes that a timestamp-only cache would miss.
    const update = (record: RecordFixture) =>
      peer.query('UPDATE tournaments SET data = $2 WHERE tournament_id = $1', [record.tournamentId, record]);

    async function fullRevision(storage: PostgresTournamentStorage, id: string) {
      const full = await storage.fetchTournamentRecords({ tournamentId: id, captureRevision: true });
      if (!('tournamentRecords' in full)) throw new Error('Missing whole-record revision oracle');
      const version = recordRevision(full.tournamentRecords[id]);
      expect(version).toBeTypeOf('string');
      return version;
    }

    async function restoreRevisionTrigger(relation: string, selection: string, id: string) {
      // Restore stamping, renew affected tokens and verify reassembly in a single peer transaction.
      const recovery = await peer.connect();
      try {
        await recovery.query('BEGIN');
        await recovery.query('ALTER TABLE ' + relation + ' ENABLE ALWAYS TRIGGER shard_cache_revision');
        await recovery.query('UPDATE ' + relation + ' SET cache_revision=cache_revision' + selection, [id]);
        expect(
          (await recovery.query('SELECT 1 FROM tournament_shard_drift WHERE tournament_id=$1', [id])).rows,
        ).toEqual([]);
        await recovery.query('COMMIT');
      } catch (error) {
        await recovery.query('ROLLBACK');
        throw error;
      } finally {
        recovery.release();
      }
    }

    it.each([
      { scope: 'draw', request: draw('a'), includesSiblings: false, includesRoster: false },
      {
        scope: 'drawParticipants',
        request: {
          footprint: tools.getMutationFootprint({
            methods: [{ method: 'setMatchUpStatus', params: { drawId: 'b' } }],
            outcomePipeline: 'v2',
          }),
        },
        includesSiblings: false,
        includesRoster: true,
      },
      { scope: 'eventDraws', request: all, includesSiblings: true, includesRoster: true },
    ])(
      'round-trips empty-hint $scope bodies and their physical order against the uncached reader',
      async ({ scope, request, includesSiblings, includesRoster }) => {
        const id = 'framing-' + scope,
          record = fixture(id);
        // Use physical order distinct from ID order. The first requested draw in eventDraws is the second row.
        const draws = record.events[0].drawDefinitions.reverse();
        const roster = record.participants.reverse();
        // U+001E is also the wire separator. The literal six characters backslash-u001e represent different content.
        const value = 'left\u001eright | literal \\u001e | "quoted"\n雪 e\u0301 é 🧑🏿‍🚀';
        for (const body of [record, ...draws, ...roster]) {
          Object.assign(body, { extensions: [{ name: 'unicode', value }] });
        }
        const { read } = await setup(id, 1_000_000, record);
        const plain = adapter(pool, id, 0).readerForTournament(id)!;
        const selectedDraws = includesSiblings ? draws : draws.filter((d) => d.drawId === request.footprint.drawIds[0]);
        const selectedRoster = includesRoster ? roster : [];
        const names = [
          record.tournamentName,
          ...selectedDraws.map((d) => d.drawName),
          ...selectedRoster.map((p) => p.participantName),
        ];
        const counts = measureShardCache(pool);
        const none = { shell: 0, draw: 0, participant: 0 };
        const selected = { shell: 1, draw: selectedDraws.length, participant: selectedRoster.length };
        try {
          const missing = { footprint: { ...request.footprint, drawIds: ['missing'] } };
          const denied = await plain(missing);
          expect(denied).toEqual({ kind: 'fallback', reason: 'missing-shards-or-layout' });
          expect(await read(missing)).toEqual(denied);
          const authority = await traceRead(pool, plain, request);
          expect(authority.result).toMatchObject({
            kind: 'partial',
            tournamentRecord: {
              events: [{ eventId: 'event', drawDefinitions: selectedDraws }],
              participants: selectedRoster,
            },
          });
          expectTransferred(authority.wire, record, names);
          expect(counts.snapshot()).toEqual({ reads: 0, transferred: none, reused: none });

          const cold = await traceRead(pool, read, request);
          expect(cold.result).toEqual(authority.result);
          expectTransferred(cold.wire, record, names);
          const [row] = JSON.parse(cold.wire);
          for (const metadata of [...row.draws, ...(row.roster ?? [])]) {
            for (const field of ['body', 'draw', 'participant']) expect(metadata).not.toHaveProperty(field);
          }
          expectTransferred(JSON.stringify([row.draws, row.roster]), record, []);
          expect(JSON.parse(row.shell_body).extensions).toEqual([{ name: 'unicode', value }]);
          const parseBodies = (text: string) => text.split('\u001e').map((json) => JSON.parse(json));
          expect(parseBodies(row.draw_bodies)).toEqual(selectedDraws);
          expect(row.draws.map((d) => [d.ord, d.draw_id])).toEqual(
            selectedDraws.map((d) => [draws.indexOf(d), d.drawId]),
          );
          if (includesRoster) {
            expect(parseBodies(row.participant_bodies)).toEqual(selectedRoster);
            expect(row.roster.map((p) => [p.ord, p.participant_id])).toEqual(
              selectedRoster.map((p, ord) => [ord, p.participantId]),
            );
          } else {
            expect(row.participant_bodies).toBeNull();
            expect(row.roster).toBeNull();
          }
          expect(counts.snapshot()).toEqual({ reads: 1, transferred: selected, reused: none });

          const hot = await traceRead(pool, read, request);
          expect(hot.result).toEqual(authority.result);
          expectTransferred(hot.wire, record, []);
          expect(counts.snapshot()).toEqual({ reads: 2, transferred: selected, reused: selected });
        } finally {
          counts.close();
        }
      },
    );

    it('keeps empty-hint roster validation and handles a valid empty roster without a body frame', async () => {
      const id = 'framing-empty',
        record = fixture(id);
      record.participants = [];
      const { read } = await setup(id, 1_000_000, record);
      const plain = adapter(pool, id, 0).readerForTournament(id)!;
      const counts = measureShardCache(pool);
      try {
        // Draw a still names participant p. No partial record or admission can survive this refusal.
        const invalid = await plain(all);
        expect(invalid).toEqual({ kind: 'fallback', reason: 'invalid-shards' });
        expect(await read(all)).toEqual(invalid);
        expect(counts.snapshot().reads).toBe(0);
        record.events[0].drawDefinitions[0].entries = [];
        await update(record);
        const valid = await plain(all);
        expect(valid).toMatchObject({ kind: 'partial', tournamentRecord: record });
        const cold = await traceRead(pool, read);
        expect(cold.result).toEqual(valid);
        expect(JSON.parse(cold.wire)[0].participant_bodies).toBeNull();
        expectTransferred(cold.wire, record, bodyNames(record));
        const hot = await traceRead(pool, read);
        expect(hot.result).toEqual(valid);
        expectTransferred(hot.wire, record, []);
        const parts = { shell: 1, draw: 2, participant: 0 };
        expect(counts.snapshot()).toEqual({ reads: 2, transferred: parts, reused: parts });
      } finally {
        counts.close();
      }
    });

    it('reports the bodies transferred on a cold read and reused on a hot read through the production observer', async () => {
      const id = 'observed-counts',
        record = fixture(id);
      record.participants.push({ participantId: 'r', participantName: 'player-r-body-before' });
      const { read } = await setup(id, 1_000_000, record);
      const counts = measureShardCache(pool);
      const none = { shell: 0, draw: 0, participant: 0 };
      const parts = { shell: 1, draw: 2, participant: 3 };
      try {
        expect(counts.snapshot()).toEqual({ reads: 0, reused: none, transferred: none });
        const cold = await observed(pool, read);
        expectTransferred(cold.wire, record, bodyNames(record));
        expect(counts.snapshot()).toEqual({ reads: 1, reused: none, transferred: parts });
        const hot = await observed(pool, read);
        expectTransferred(hot.wire, record, []);
        expect(hot.tournamentRecord).toEqual(record);
        expect(counts.snapshot()).toEqual({ reads: 2, reused: parts, transferred: parts });
      } finally {
        counts.close();
      }
    });

    it('fetches each shell, draw and participant body independently and returns a private parsed graph on every hit', async () => {
      const { read, record } = await setup('parts');
      const [shell, a, b, p, q] = bodyNames(record);
      const first = await observed(pool, read, draw('a'));
      expectTransferred(first.wire, record, [shell, a]);
      const next = await observed(pool, read);
      expectTransferred(next.wire, record, [b, p, q]);
      expect(next.tournamentRecord).toEqual(record);
      const warm = await observed(pool, read);
      expectTransferred(warm.wire, record, []);
      warm.tournamentRecord.tournamentName = 'private edit';
      warm.tournamentRecord.events![0].drawDefinitions![0].entries![0].participantId = 'private edit';
      warm.tournamentRecord.participants![1].participantName = 'private edit';
      expect(next.tournamentRecord).toEqual(record);
      const reread = await observed(pool, read);
      expectTransferred(reread.wire, record, []);
      expect(reread.tournamentRecord).toEqual(record);
    });

    it('reuses the same parts for a scoring footprint while keeping sibling draws outside the loaded footprint', async () => {
      const { read, record } = await setup('score');
      const first = await partial(read);
      const scoring = {
        footprint: tools.getMutationFootprint({
          methods: [{ method: 'setMatchUpStatus', params: { drawId: 'b' } }],
          outcomePipeline: 'v2',
        }),
      };
      const result = await observed(pool, read, scoring);
      expectTransferred(result.wire, record, []);
      expect(result.loadedFootprint.shards).toEqual(['shell', 'draw', 'participants']);
      expect(result.loadedFootprint.drawIds).toEqual(['b']);
      expect(result.tournamentRecord.events![0].drawDefinitions).toEqual([record.events[0].drawDefinitions[1]]);
      expect(result.tournamentRecord.participants).toEqual(record.participants);
      expect(result.parentRevision).toBe(first.parentRevision);
    });

    it('refreshes only the changed bodies across peer writes with an unchanged parent timestamp', async () => {
      const id = 'granularity';
      const { read, record, storage } = await setup(id);
      const first = await partial(read);
      let previous = recordRevision(first.tournamentRecord);
      expect(previous).toBe(await fullRevision(storage, id));
      for (const change of [
        () => (record.participants[0].participantName += '-changed'),
        () => (record.events[0].drawDefinitions[1].drawName += '-changed'),
        () => (record.tournamentName += '-changed'),
      ]) {
        const marker = change();
        await update(record);
        const result = await observed(pool, read);
        expectTransferred(result.wire, record, [marker]);
        expect(result.tournamentRecord).toEqual(record);
        expect(result.previousServerUpdatedAt).toBe(first.previousServerUpdatedAt);
        const revision = recordRevision(result.tournamentRecord);
        expect(revision).not.toBe(previous);
        expect(revision).toBe(await fullRevision(storage, id));
        previous = revision;
      }
      // The parent xmin can move while every physical body and updated_at remain unchanged.
      await update(record);
      const allHits = await observed(pool, read);
      expectTransferred(allHits.wire, record, []);
      expect(allHits.previousServerUpdatedAt).toBe(first.previousServerUpdatedAt);
      expect(allHits.tournamentRecord).toEqual(record);
      expect(recordRevision(allHits.tournamentRecord)).not.toBe(previous);
      expect(recordRevision(allHits.tournamentRecord)).toBe(await fullRevision(storage, id));
    });

    it('scopes shared migration tokens by tournament and physical row, including untouched pre-067 bodies', async () => {
      const id = 'pre-067',
        otherId = 'pre-067-peer';
      const record = fixture(id),
        other = fixture(otherId, 'different-record');
      const storage = adapter(pool, [id, otherId].join(','), 1_000_000);
      const read = storage.readerForTournament(id)!;
      const readOther = storage.readerForTournament(otherId)!;
      const { rows: tokens } = await peer.query(
        'SELECT DISTINCT cache_revision FROM tournament_participants WHERE tournament_id = ANY($1)',
        [[id, otherId]],
      );
      expect(tokens).toEqual([{ cache_revision: expect.any(String) }]);
      expectTransferred((await observed(pool, read, draw('a'))).wire, record, bodyNames(record).slice(0, 2));
      const first = await observed(pool, read);
      expectTransferred(first.wire, record, bodyNames(record).slice(2));
      expect(first.tournamentRecord).toEqual(record);
      expectTransferred((await observed(pool, read)).wire, record, []);
      const differentTournament = await observed(pool, readOther);
      expectTransferred(differentTournament.wire, other, bodyNames(other));
      expect(differentTournament.tournamentRecord).toEqual(other);
      record.participants[1].participantName += '-edited';
      await update(record);
      const changed = await observed(pool, read);
      expectTransferred(changed.wire, record, [record.participants[1].participantName]);
      expect(changed.tournamentRecord).toEqual(record);
      const untouched = await observed(pool, readOther);
      expectTransferred(untouched.wire, other, []);
      expect(untouched.tournamentRecord).toEqual(other);
    });

    it('removes deleted children, rejects missing coverage, and restores current values at reused positions', async () => {
      const { read, record } = await setup('coverage');
      await partial(read);
      const lastDraw = record.events[0].drawDefinitions.pop()!;
      const lastPlayer = record.participants.pop()!;
      await update(record);
      expect((await partial(read)).tournamentRecord).toEqual(record);
      expect((await read(draw('b'))).kind).toBe('fallback');
      record.events[0].drawDefinitions.push({ ...lastDraw, drawName: 'restored-draw' });
      record.participants.push({ ...lastPlayer, participantName: 'restored-player' });
      await update(record);
      const restored = await observed(pool, read);
      expectTransferred(restored.wire, record, ['restored-draw', 'restored-player']);
      expect(restored.tournamentRecord).toEqual(record);
      // A complete roster is required for the entries in draw a; a cached participant cannot fill
      // a physical hole. The nonterminal ordinal also leaves an independently visible gap.
      await peer.query("DELETE FROM tournament_participants WHERE tournament_id=$1 AND participant_id='p'", [
        record.tournamentId,
      ]);
      expect((await read(all)).kind).toBe('fallback');
      await layout(record.tournamentId, 'sharded');
      expect((await partial(read)).tournamentRecord).toEqual(record);
      expect((await read({ ...all, drawEventIds: { a: 'wrong-event' } })).kind).toBe('fallback');
    });

    it('withdraws retained coverage across a layout change and deletion, then reads the replacement tournament', async () => {
      const id = 'reused';
      const { read, storage } = await setup(id);
      const original = await partial(read);
      await peer.query('ALTER TABLE tournaments DISABLE TRIGGER tournaments_shard_sync');
      try {
        expect((await read(all)).kind).toBe('fallback');
      } finally {
        await peer.query('ALTER TABLE tournaments ENABLE TRIGGER tournaments_shard_sync');
      }
      await layout(id, 'document');
      expect((await read(all)).kind).toBe('fallback');
      await update(fixture(id, 'document-edit'));
      await layout(id, 'sharded');
      expect((await partial(read)).tournamentRecord).toEqual(fixture(id, 'document-edit'));
      const peerStorage = adapter(peer, id, 0);
      expect(await peerStorage.removeTournamentRecords({ tournamentId: id })).toMatchObject({ removed: 1 });
      expect((await read(all)).kind).toBe('fallback');
      const replacement = fixture(id, 'replacement');
      expect(await peerStorage.saveTournamentRecord({ tournamentRecord: replacement })).toMatchObject({
        success: true,
      });
      expect((await read(all)).kind).toBe('fallback');
      await layout(id, 'sharded');
      const restored = await observed(pool, read);
      expectTransferred(restored.wire, replacement, bodyNames(replacement));
      expect(restored.tournamentRecord).toEqual(replacement);
      expect(recordRevision(restored.tournamentRecord)).toBe(await fullRevision(storage, id));
      expect(restored.parentRevision).not.toBe(original.parentRevision);
    });

    it('re-fetches an evicted draw while a repeat within the same byte budget suppresses its body', async () => {
      const id = 'evict',
        record = fixture(id);
      record.events[0].drawDefinitions.forEach((d) => {
        d.drawName += 'x'.repeat(5000);
      });
      const { read } = await setup(id, 8000, record);
      const [a, b] = record.events[0].drawDefinitions;
      expect((await observed(pool, read, draw('a'))).wire).toContain(a.drawName);
      expect((await observed(pool, read, draw('a'))).wire).not.toContain(a.drawName);
      expect((await observed(pool, read, draw('b'))).wire).toContain(b.drawName);
      const evicted = await observed(pool, read, draw('a'));
      expect(evicted.wire).toContain(a.drawName);
      expect(evicted.tournamentRecord.events![0].drawDefinitions).toEqual([a]);
    });

    it('finishes an in-flight hit from its own snapshot after a peer commit and newer overlapping read', async () => {
      const id = 'overlap';
      const { storage, read, record } = await setup(id);
      const initial = await partial(read);
      const initialRevision = await fullRevision(storage, id);
      const query = pool.query.bind(pool);
      let previousWire = '';
      let received!: () => void;
      let resume!: () => void;
      const receivedRows = new Promise<void>((resolve) => {
        received = resolve;
      });
      const release = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const hold = vi.spyOn(pool, 'query').mockImplementationOnce((async (sql: string, values: unknown[]) => {
        const result = await query(sql, values);
        previousWire = JSON.stringify(result.rows);
        received();
        await release;
        return result;
      }) as Pool['query']);
      const older = partial(read);
      try {
        await Promise.race([
          receivedRows,
          older.then(() => {
            throw new Error('Reader bypassed the database');
          }),
        ]);
        expectTransferred(previousWire, record, []);
        const replacement = fixture(id, 'committed-in-flight');
        await update(replacement);
        const latest = await partial(read);
        expect(latest.tournamentRecord).toEqual(replacement);
        expect(recordRevision(latest.tournamentRecord)).toBe(await fullRevision(storage, id));
        expect(latest.parentRevision).not.toBe(initial.parentRevision);
        resume();
        const delayed = await older;
        expect(delayed.tournamentRecord).toEqual(record);
        expect(delayed.parentRevision).toBe(initial.parentRevision);
        expect(recordRevision(delayed.tournamentRecord)).toBe(initialRevision);
        const final = await partial(read);
        expect(final.tournamentRecord).toEqual(replacement);
        expect(final.parentRevision).toBe(latest.parentRevision);
      } finally {
        resume();
        hold.mockRestore();
        await older;
      }
    });

    it('keeps uncommitted versions private and leaves a warm committed reader intact after rollback', async () => {
      const id = 'rollback';
      const { read, record, storage } = await setup(id);
      const original = await partial(read);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await commandTransaction.run({ pool, client, afterCommit: [] }, async () => {
          for (const label of ['uncommitted-1', 'uncommitted-2']) {
            const local = fixture(id, label);
            await client.query('UPDATE tournaments SET data=$2 WHERE tournament_id=$1', [id, local]);
            const inside = await partial(read);
            expect(inside.tournamentRecord).toEqual(local);
            expect(recordRevision(inside.tournamentRecord)).toBe(await fullRevision(storage, id));
            expect(inside.parentRevision).not.toBe(original.parentRevision);
          }
        });
        // The same worker and cache, on a separate connection while the writer is still open.
        const outside = await observed(pool, read);
        expect(outside.tournamentRecord).toEqual(record);
        expect(outside.parentRevision).toBe(original.parentRevision);
        expectTransferred(outside.wire, record, []);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      const restored = await observed(pool, read);
      expect(restored.tournamentRecord).toEqual(record);
      expect(restored.parentRevision).toBe(original.parentRevision);
      expectTransferred(restored.wire, record, []);
    });

    it('uses exactly the ordinary physical statement with a zero budget on cold and repeated reads', async () => {
      const id = 'disabled';
      const { read, record } = await setup(id, 0);
      const ordinary = await observed(pool, (request) => readPhysicalFootprint(pool, { ...request, tournamentId: id }));
      for (let i = 0; i < 2; i++) {
        const result = await observed(pool, read);
        expect(result.sql).toBe(ordinary.sql);
        expect(result.sql).not.toMatch(/cache_revision/i);
        expectTransferred(result.wire, record, bodyNames(record));
        expect(result.tournamentRecord).toEqual(record);
        expect(result.parentRevision).toBe(ordinary.parentRevision);
      }
    });

    it.each([
      {
        relation: 'tournament_shells',
        field: "shell->>'tournamentName'",
        where: '',
        edit: (r: RecordFixture) => (r.tournamentName += '-peer'),
      },
      {
        relation: 'draw_definitions',
        field: "draw->>'drawName'",
        where: ' AND event_ord=0 AND ord=0',
        edit: (r: RecordFixture) => (r.events[0].drawDefinitions[0].drawName += '-peer'),
      },
      {
        relation: 'tournament_participants',
        field: "participant->>'participantName'",
        where: ' AND ord=0',
        edit: (r: RecordFixture) => (r.participants[0].participantName += '-peer'),
      },
    ])(
      'rejects a previously warm token after the revision trigger on $relation stops stamping changes',
      async ({ relation, field, where, edit }) => {
        const id = 'guard-' + relation;
        const { read, record, storage } = await setup(id);
        const cold = adapter(pool, id, 1_000_000).readerForTournament(id)!;
        const selection = ' WHERE tournament_id=$1' + where;
        const stored = async () =>
          (await peer.query('SELECT cache_revision, ' + field + ' AS name FROM ' + relation + selection, [id])).rows[0];
        await partial(read);
        expectTransferred((await observed(pool, read)).wire, record, []);
        const before = await stored();
        expect(before.cache_revision).toBeTypeOf('string');
        await peer.query('ALTER TABLE ' + relation + ' DISABLE TRIGGER shard_cache_revision');
        try {
          const changed = edit(record);
          await update(record);
          expect(changed).not.toEqual(before.name);
          expect(await stored()).toEqual({ cache_revision: before.cache_revision, name: changed });
          // One worker already has the obsolete body. A second starts cold during the outage.
          for (const reader of [read, cold]) {
            const trace = await traceRead(pool, reader);
            if (trace.result.kind === 'partial') {
              expect(trace.result.tournamentRecord).toEqual(record);
              expectTransferred(trace.wire, record, bodyNames(record));
              expect(recordRevision(trace.result.tournamentRecord)).toBe(await fullRevision(storage, id));
            } else {
              expect(await storage.findTournamentRecord({ tournamentId: id })).toEqual({ tournamentRecord: record });
            }
          }
        } finally {
          await restoreRevisionTrigger(relation, selection, id);
        }
        expect((await stored()).cache_revision).not.toBe(before.cache_revision);
        const repaired = await observed(pool, cold);
        expectTransferred(repaired.wire, record, bodyNames(record));
        expect(repaired.tournamentRecord).toEqual(record);
        expect((await partial(read)).tournamentRecord).toEqual(record);
      },
    );
  },
);
