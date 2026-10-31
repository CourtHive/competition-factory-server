import { Pool } from 'pg';

import { MAX_DELTAS_PER_STATEMENT, PostgresProjectionOutboxStorage } from './postgres-projection-outbox.storage';

/**
 * The projection outbox's fence and chunking against a REAL Postgres (Mentat/planning/CFS_LARGE_SAVES.md §10, P2/P4).
 *
 * The fence is a property of SQL (`FOR SHARE`, a text compare of `updated_at`) and of transactions, which a mocked pool
 * cannot show. Opt-in like `calendarTournaments.e2e.spec.ts`, and in its own scratch schema, set on every pooled
 * connection, so neither a real `tournaments` nor a real `projection_queue` is ever in reach:
 *
 *   PROJECTION_DB_TESTS=true PGGSSENCMODE=disable pnpm test -- projectionOutboxFence
 */

const RUN = process.env.PROJECTION_DB_TESTS === 'true';
const d = RUN ? describe : describe.skip;
const SCHEMA = 'projection_fence_test';

d('projection outbox fence and chunking (real Postgres)', () => {
  let pool: Pool;
  let outbox: PostgresProjectionOutboxStorage;

  const delta = (tournamentId: string, n: number) => ({
    tournamentId,
    op: 'upsert' as const,
    table: 'match_ups',
    key: { match_up_id: `m-${n}` },
    row: { match_up_id: `m-${n}`, tournament_id: tournamentId },
    topic: 'test',
  });

  const queued = async (tournamentId: string) =>
    (
      await pool.query('SELECT op, snapshot_id FROM projection_queue WHERE tournament_id = $1 ORDER BY seq', [
        tournamentId,
      ])
    ).rows;

  beforeAll(async () => {
    const admin = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER || process.env.USER,
      password: process.env.PG_PASSWORD || '',
      database: process.env.PG_DATABASE || 'courthive',
    });
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await admin.end();

    pool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER || process.env.USER,
      password: process.env.PG_PASSWORD || '',
      database: process.env.PG_DATABASE || 'courthive',
      options: `-c search_path=${SCHEMA}`,
    });
    await pool.query(
      'CREATE TABLE IF NOT EXISTS tournaments (tournament_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
    );
    await pool.query(`CREATE TABLE IF NOT EXISTS projection_snapshot_requests (
      tournament_id TEXT PRIMARY KEY, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), source TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS projection_document_requests (
      tournament_id TEXT PRIMARY KEY, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), source TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS projection_queue (
      seq BIGSERIAL PRIMARY KEY, tournament_id TEXT, op TEXT, table_name TEXT, row_key JSONB, row_data JSONB,
      topic TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), snapshot_id TEXT)`);
    process.env.PROJECTION_OUTBOX_ENABLED = 'true';
    outbox = new PostgresProjectionOutboxStorage(pool);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE tournaments, projection_queue, projection_snapshot_requests, projection_document_requests',
    );
    await pool.query(`INSERT INTO tournaments (tournament_id, data) VALUES ('t-1', '{"tournamentId":"t-1"}')`);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  it('enqueues deltas built from the record still stored, with their span id', async () => {
    const source = await outbox.readForProjection('t-1');
    const deltas = [delta('t-1', 1), { ...delta('t-1', 2), snapshotId: 'snap-1' }];

    const outcome = await outbox.enqueueIfUnchanged({ tournamentId: 't-1', updatedAt: source!.updatedAt, deltas });

    expect(outcome).toBe('enqueued');
    expect(await queued('t-1')).toEqual([
      { op: 'upsert', snapshot_id: null },
      { op: 'upsert', snapshot_id: 'snap-1' },
    ]);
  });

  // The window the fence closes: a save committed between the unlocked read and the enqueue
  it('writes nothing when the record changed after it was read', async () => {
    const source = await outbox.readForProjection('t-1');
    await pool.query(
      `UPDATE tournaments SET data = '{"tournamentId":"t-1","v":2}', updated_at = NOW() WHERE tournament_id = 't-1'`,
    );

    const outcome = await outbox.enqueueIfUnchanged({
      tournamentId: 't-1',
      updatedAt: source!.updatedAt,
      deltas: [delta('t-1', 1)],
    });

    expect(outcome).toBe('changed');
    expect(await queued('t-1')).toEqual([]);
  });

  // updated_at keeps microseconds; a value that round-tripped through a JS Date would not match itself
  it('compares the row version to the microsecond', async () => {
    const { rows } = await pool.query(`SELECT updated_at::text AS v FROM tournaments WHERE tournament_id = 't-1'`);
    const millisecondsOnly = new Date(rows[0].v).toISOString();
    expect(rows[0].v).not.toEqual(millisecondsOnly);

    const outcome = await outbox.enqueueIfUnchanged({ tournamentId: 't-1', updatedAt: millisecondsOnly, deltas: [] });
    expect(outcome).toBe('changed');
  });

  it('reports a tournament that no longer exists', async () => {
    const outcome = await outbox.enqueueIfUnchanged({
      tournamentId: 'gone',
      updatedAt: 'x',
      deltas: [delta('gone', 1)],
    });
    expect(outcome).toBe('missing');
    expect(await queued('gone')).toEqual([]);
  });

  // A span used to be ONE statement: over ~9,300 rows it exceeded Postgres's 65,535 bind parameters and failed
  it('writes a span larger than one statement allows, whole', async () => {
    // 15,007 rows: one statement at the old six parameters a row would need 90,042, over the limit
    const count = MAX_DELTAS_PER_STATEMENT * 3 + 7;
    const deltas = Array.from({ length: count }, (_, n) => delta('t-1', n));

    await outbox.enqueue(deltas);

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM projection_queue WHERE tournament_id = 't-1'`);
    expect(rows[0].n).toBe(count);
  });

  it('writes no part of a span when one of its statements fails', async () => {
    const good = Array.from({ length: MAX_DELTAS_PER_STATEMENT }, (_, n) => delta('t-1', n));
    // a key that cannot be serialised as JSON fails the second statement after the first succeeded
    const circular: any = { match_up_id: 'm-loop' };
    circular.self = circular;
    const bad = { ...delta('t-1', -1), key: circular };

    await expect(outbox.enqueue([...good, bad])).rejects.toThrow();
    expect(await queued('t-1')).toEqual([]);
  });

  // The ordering the producer relies on: a save that starts while the fence holds its share lock waits for it
  it('makes a concurrent save of the same tournament wait for the fenced insert', async () => {
    const source = await outbox.readForProjection('t-1');
    const locker = await pool.connect();
    const saver = await pool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query(`SELECT 1 FROM tournaments WHERE tournament_id = 't-1' FOR SHARE`);

      let saved = false;
      const save = saver
        .query(
          `INSERT INTO tournaments (tournament_id, data) VALUES ('t-1', '{}')
           ON CONFLICT (tournament_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        )
        .then(() => {
          saved = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(saved).toBe(false);

      await locker.query('COMMIT');
      await save;
      expect(saved).toBe(true);

      // and the fence, read before that save, now refuses
      const outcome = await outbox.enqueueIfUnchanged({
        tournamentId: 't-1',
        updatedAt: source!.updatedAt,
        deltas: [],
      });
      expect(outcome).toBe('changed');
    } finally {
      locker.release();
      saver.release();
    }
  });

  describe('snapshot requests', () => {
    const pending = async () => outbox.pendingSnapshotRequests(10);

    it('coalesces repeat requests for one tournament and resets a failed one', async () => {
      await outbox.requestSnapshots(['t-1', 't-1'], 'factory-save');
      await outbox.recordSnapshotFailure('t-1', 'boom');
      await outbox.requestSnapshots(['t-1'], 'provider-key');

      const requests = await pending();
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ tournamentId: 't-1', source: 'provider-key', attempts: 0 });
    });

    it('completes a request: span written and request removed, in one commit', async () => {
      await outbox.requestSnapshots(['t-1'], 'factory-save');
      const [request] = await pending();
      const source = await outbox.readForProjection('t-1');

      const outcome = await outbox.completeSnapshot({
        tournamentId: 't-1',
        requestedAt: request.requestedAt,
        updatedAt: source!.updatedAt,
        deltas: [{ ...delta('t-1', 1), snapshotId: 's' }],
      });

      expect(outcome).toBe('enqueued');
      expect(await pending()).toEqual([]);
      expect(await queued('t-1')).toHaveLength(1);
    });

    // A save that re-requests the snapshot while it is being built must not lose that request to the build's commit
    it('keeps a request re-made while its span was being built', async () => {
      await outbox.requestSnapshots(['t-1'], 'factory-save');
      const [request] = await pending();
      const source = await outbox.readForProjection('t-1');
      await outbox.requestSnapshots(['t-1'], 'factory-save');

      await outbox.completeSnapshot({
        tournamentId: 't-1',
        requestedAt: request.requestedAt,
        updatedAt: source!.updatedAt,
        deltas: [],
      });

      expect(await pending()).toHaveLength(1);
    });

    it('keeps the request, and writes nothing, when the record changed during the build', async () => {
      await outbox.requestSnapshots(['t-1'], 'factory-save');
      const [request] = await pending();
      const source = await outbox.readForProjection('t-1');
      await pool.query(`UPDATE tournaments SET updated_at = NOW() WHERE tournament_id = 't-1'`);

      const outcome = await outbox.completeSnapshot({
        tournamentId: 't-1',
        requestedAt: request.requestedAt,
        updatedAt: source!.updatedAt,
        deltas: [delta('t-1', 1)],
      });

      expect(outcome).toBe('changed');
      expect(await pending()).toHaveLength(1);
      expect(await queued('t-1')).toEqual([]);
    });
  });
  // Migration 057: the same mechanism over its own table, so a participant change and a wholesale save never consume
  // each other's request.
  describe('participant document requests', () => {
    const pending = async () => outbox.pendingParticipantDocumentRequests(10);

    it('coalesces repeat requests for one tournament and resets a failed one', async () => {
      await outbox.requestParticipantDocuments(['t-1', 't-1'], 'mutation');
      await outbox.recordParticipantDocumentFailure('t-1', 'boom');
      await outbox.requestParticipantDocuments(['t-1'], 'factory-save');

      const requests = await pending();
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ tournamentId: 't-1', source: 'factory-save', attempts: 0 });
    });

    it('is separate from snapshot requests', async () => {
      await outbox.requestParticipantDocuments(['t-1'], 'mutation');
      expect(await outbox.pendingSnapshotRequests(10)).toEqual([]);

      await outbox.requestSnapshots(['t-1'], 'factory-save');
      const [snapshot] = await outbox.pendingSnapshotRequests(10);
      const source = await outbox.readForProjection('t-1');
      await outbox.completeSnapshot({
        tournamentId: 't-1',
        requestedAt: snapshot.requestedAt,
        updatedAt: source!.updatedAt,
        deltas: [],
      });
      expect(await pending()).toHaveLength(1);
    });

    it('completes a request: span written and request removed, in one commit', async () => {
      await outbox.requestParticipantDocuments(['t-1'], 'mutation');
      const [request] = await pending();
      const source = await outbox.readForProjection('t-1');

      const outcome = await outbox.completeParticipantDocuments({
        tournamentId: 't-1',
        requestedAt: request.requestedAt,
        updatedAt: source!.updatedAt,
        deltas: [{ ...delta('t-1', 1), snapshotId: 's' }],
      });

      expect(outcome).toBe('enqueued');
      expect(await pending()).toEqual([]);
      expect(await queued('t-1')).toHaveLength(1);
    });

    it('keeps the request, and writes nothing, when the record changed during the build', async () => {
      await outbox.requestParticipantDocuments(['t-1'], 'mutation');
      const [request] = await pending();
      const source = await outbox.readForProjection('t-1');
      await pool.query(`UPDATE tournaments SET updated_at = NOW() WHERE tournament_id = 't-1'`);

      const outcome = await outbox.completeParticipantDocuments({
        tournamentId: 't-1',
        requestedAt: request.requestedAt,
        updatedAt: source!.updatedAt,
        deltas: [delta('t-1', 1)],
      });

      expect(outcome).toBe('changed');
      expect(await pending()).toHaveLength(1);
      expect(await queued('t-1')).toEqual([]);
    });
  });
});
