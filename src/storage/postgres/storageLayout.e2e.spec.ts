import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

import { PostgresProjectionOutboxStorage } from './postgres-projection-outbox.storage';
import { PostgresTournamentStorage } from './postgres-tournament.storage';

/**
 * The storage-layout seam (migration 061) against a REAL Postgres: `tournament_document()` and `tournament_shell()`,
 * which every whole-record read now selects through, and the per-tournament layout table.
 *
 * What it proves: in the `document` layout the seam changes nothing (every read returns the stored record, byte for
 * byte), the planner inlines both functions (no function call per row), and a tournament with no layout row is in
 * `document`. A mocked pool cannot show any of that.
 *
 * Opt-in: skipped unless STORAGE_LAYOUT_DB_TESTS=true, because CI has no Postgres. Built from the migration files in a
 * scratch schema, so no real `tournaments` row is in reach:
 *
 *   STORAGE_LAYOUT_DB_TESTS=true PGGSSENCMODE=disable pnpm test -- storageLayout
 */

const RUN = process.env.STORAGE_LAYOUT_DB_TESTS === 'true';
const d = RUN ? describe : describe.skip;
const SCHEMA = 'storage_layout_061_test';
const migration = (file: string) => readFileSync(join(__dirname, 'migrations', file), 'utf8');

const record = (tournamentId: string) => ({
  tournamentId,
  tournamentName: 'Open',
  parentOrganisation: { organisationId: 'prov-1' },
  extensions: [{ name: 'x', value: { a: 1 } }],
  participants: [{ participantId: 'p-1', participantName: 'Ann' }],
  events: [{ eventId: 'e-1', drawDefinitions: [{ drawId: 'd-1', structures: [] }] }],
});

d('storage-layout seam (real Postgres)', () => {
  let pool: Pool;
  let storage: PostgresTournamentStorage;
  let outbox: PostgresProjectionOutboxStorage;

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER || process.env.USER,
      password: process.env.PG_PASSWORD || '',
      database: process.env.PG_DATABASE || 'courthive',
      options: `-c search_path=${SCHEMA}`,
    });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    for (const file of [
      '001-initial-schema.sql',
      '042-add-tournament-owner-epoch.sql',
      '061-tournament-storage-layout.sql',
    ]) {
      await pool.query(migration(file));
    }
    storage = new PostgresTournamentStorage(pool as any);
    outbox = new PostgresProjectionOutboxStorage(pool as any);
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE tournaments, tournament_storage_layout');
  });

  it('061 is idempotent', async () => {
    await pool.query(migration('061-tournament-storage-layout.sql'));
  });

  it('every whole-record read returns the stored record unchanged in the document layout', async () => {
    const stored = record('t-1');
    let result: any = await storage.saveTournamentRecord({ tournamentRecord: stored });
    expect(result.success).toBe(true);

    result = await storage.findTournamentRecord({ tournamentId: 't-1' });
    expect(result.tournamentRecord).toEqual(stored);

    result = await storage.fetchTournamentRecords({ tournamentIds: ['t-1'] });
    expect(result.tournamentRecords['t-1']).toEqual(stored);

    result = await storage.fetchTournamentUpdatedAt({ tournamentId: 't-1' });
    expect(result.providerId).toBe('prov-1');
    expect(result.extensions).toEqual(stored.extensions);

    result = await outbox.readForProjection('t-1');
    expect(result.tournamentRecord).toEqual(stored);
  });

  it('the planner inlines both seam functions', async () => {
    const plan = async (sql: string) =>
      (await pool.query(`EXPLAIN (VERBOSE, FORMAT TEXT) ${sql}`)).rows.map((r) => r['QUERY PLAN']).join('\n');

    const document = await plan(
      "SELECT tournament_document(tournament_id, data) FROM tournaments WHERE tournament_id = 't'",
    );
    expect(document).not.toMatch(/tournament_document/);
    const shell = await plan(
      "SELECT shell->'extensions' FROM tournaments, tournament_shell(tournament_id, data) AS shell WHERE tournament_id = 't'",
    );
    expect(shell).not.toMatch(/tournament_shell/);
  });

  it('a tournament without a layout row is in document; a row says otherwise', async () => {
    let layouts: any = await storage.fetchStorageLayouts({ tournamentIds: ['t-1', 't-2'] });
    expect(layouts).toEqual({ 't-1': 'document', 't-2': 'document' });

    await pool.query("INSERT INTO tournament_storage_layout (tournament_id, layout) VALUES ('t-2', 'sharded')");
    layouts = await storage.fetchStorageLayouts({ tournamentIds: ['t-1', 't-2'] });
    expect(layouts).toEqual({ 't-1': 'document', 't-2': 'sharded' });

    expect(await storage.fetchStorageLayouts({ tournamentIds: [] })).toEqual({});
  });

  it('refuses a layout that is not document or sharded', async () => {
    await expect(
      pool.query("INSERT INTO tournament_storage_layout (tournament_id, layout) VALUES ('t-3', 'columnar')"),
    ).rejects.toThrow(/check constraint/);
  });
});
