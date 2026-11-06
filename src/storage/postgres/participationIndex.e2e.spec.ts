import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

import { PostgresParticipationStorage } from './postgres-participation.storage';

/**
 * `participation_index` and its fingerprint (migration 060), and lz4 on `tournaments.data` (059), against a REAL
 * Postgres.
 *
 * The unit spec mocks the pool, so it cannot tell whether the SQL runs: the `unnest` with its `date[]` and `int[]`
 * casts, the conditional fingerprint claim, the delete of both tables in one statement. This can.
 *
 * Opt-in, like `calendarTournaments.e2e.spec.ts`: skipped unless PARTICIPATION_DB_TESTS=true, because CI has no
 * Postgres. The tables are built from the migration files themselves, in a scratch schema, so a real
 * `participation_index` or `tournaments` is never in reach:
 *
 *   PARTICIPATION_DB_TESTS=true PGGSSENCMODE=disable pnpm test -- participationIndex
 */

const RUN = process.env.PARTICIPATION_DB_TESTS === 'true';
const d = RUN ? describe : describe.skip;
const SCHEMA = 'participation_060_test';
const migration = (file: string) => readFileSync(join(__dirname, 'migrations', file), 'utf8');

const row = (subjectId: string, over: any = {}) => ({
  subjectType: 'INDIVIDUAL' as const,
  subjectId,
  tournamentId: 't-1',
  participantId: `p-${subjectId}`,
  organisationId: 'body-A',
  providerId: 'prov-1',
  tournamentName: 'Open',
  startDate: '2026-07-01',
  endDate: '2026-07-04',
  eventCount: 1,
  ...over,
});

d('participation_index with its fingerprint (real Postgres)', () => {
  let pool: Pool;
  let storage: PostgresParticipationStorage;
  const rowsOf = async (tournamentId = 't-1') =>
    (
      await pool.query(
        'SELECT subject_id, participant_id, start_date::text, event_count, updated_at FROM participation_index WHERE tournament_id = $1 ORDER BY subject_id',
        [tournamentId],
      )
    ).rows;

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER || process.env.USER,
      password: process.env.PG_PASSWORD || '',
      database: process.env.PG_DATABASE || 'courthive',
      // every connection, not just the first: a pooled `SET search_path` reaches one connection only
      options: `-c search_path=${SCHEMA}`,
    });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    for (const file of [
      '045-add-participation-index.sql',
      '046-participation-issuing-organisation.sql',
      '060-participation-index-state.sql',
    ]) {
      await pool.query(migration(file));
    }
    storage = new PostgresParticipationStorage(pool as any);
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE participation_index, participation_index_state');
  });

  it('writes the rows once, then leaves them untouched while they stay the same', async () => {
    expect(await storage.replaceTournamentRows('t-1', [row('a'), row('b')])).toEqual({ success: true });
    const first = await rowsOf();
    expect(first.map((r) => [r.subject_id, r.start_date, r.event_count])).toEqual([
      ['a', '2026-07-01', 1],
      ['b', '2026-07-01', 1],
    ]);

    expect(await storage.replaceTournamentRows('t-1', [row('b'), row('a')])).toEqual({
      success: true,
      unchanged: true,
    });
    const second = await rowsOf();
    expect(second.map((r) => r.updated_at.toISOString())).toEqual(first.map((r) => r.updated_at.toISOString()));
  });

  it('replaces changed rows in one transaction: an edited row changes, a removed one goes', async () => {
    await storage.replaceTournamentRows('t-1', [row('a'), row('b')]);
    expect(await storage.replaceTournamentRows('t-1', [row('a', { eventCount: 2 })])).toEqual({ success: true });
    expect((await rowsOf()).map((r) => [r.subject_id, r.event_count])).toEqual([['a', 2]]);
  });

  it('writes 600 rows in a single statement, nulls and dates intact', async () => {
    const many = Array.from({ length: 600 }, (_, i) =>
      row(`s-${String(i).padStart(3, '0')}`, i % 2 ? { startDate: undefined, eventCount: undefined } : {}),
    );
    await storage.replaceTournamentRows('t-1', many);
    const stored = await rowsOf();
    expect(stored).toHaveLength(600);
    expect(stored[0]).toMatchObject({ subject_id: 's-000', start_date: '2026-07-01', event_count: 1 });
    expect(stored[1]).toMatchObject({ subject_id: 's-001', start_date: null, event_count: null });
  });

  it('forgets the fingerprint with the rows, so the same rows are written again after a delete', async () => {
    await storage.replaceTournamentRows('t-1', [row('a')]);
    await storage.deleteTournamentRows('t-1');
    expect(await rowsOf()).toEqual([]);
    expect(await storage.replaceTournamentRows('t-1', [row('a')])).toEqual({ success: true });
    expect(await rowsOf()).toHaveLength(1);
  });

  it('keeps one tournament from short-circuiting another', async () => {
    await storage.replaceTournamentRows('t-1', [row('a')]);
    expect(await storage.replaceTournamentRows('t-2', [row('a', { tournamentId: 't-2' })])).toEqual({ success: true });
    expect(await rowsOf('t-2')).toHaveLength(1);
  });

  it('059 sets lz4 on tournaments.data, or keeps pglz and says so where lz4 is unavailable', async () => {
    await pool.query('CREATE TABLE tournaments (tournament_id TEXT PRIMARY KEY, data JSONB NOT NULL)');
    await pool.query(migration('059-tournaments-data-lz4.sql'));
    await pool.query(migration('059-tournaments-data-lz4.sql')); // idempotent
    const { rows } = await pool.query(
      `SELECT attcompression FROM pg_attribute
        WHERE attrelid = '${SCHEMA}.tournaments'::regclass AND attname = 'data'`,
    );
    // Decide what to expect from the server itself, so neither branch can pass vacuously.
    const lz4Available = await pool.query('SET LOCAL default_toast_compression = lz4').then(
      () => true,
      () => false,
    );
    expect(rows[0].attcompression).toBe(lz4Available ? 'l' : '');
  });
});
