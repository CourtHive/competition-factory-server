import { PostgresTournamentStorage } from './postgres-tournament.storage';
import { fetchPhysicalShellMetadata } from './physicalShellMetadata';
import { commandTransaction } from './commandTransaction';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';

describe.skipIf(process.env.STORAGE_LAYOUT_DB_TESTS !== 'true')('physical authorization metadata (Postgres)', () => {
  const schema = 'shell_metadata_' + randomUUID().replace(/-/g, '');
  const config = {
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT) || 5432,
    user: process.env.PG_USER || process.env.USER,
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'courthive',
    options: `-c search_path=${schema}`,
  };
  let pool: Pool;
  let storage: PostgresTournamentStorage;
  const ordinary = (ids: string[]) => storage.fetchTournamentMetadata(ids);
  const read = (ids: string[]) => fetchPhysicalShellMetadata(pool, ids, ordinary);
  const shard = (id: string) => pool.query("SELECT set_tournament_storage_layout($1, 'sharded')", [id]);
  async function save(id: string) {
    await storage.saveTournamentRecord({
      tournamentRecord: {
        tournamentId: id,
        parentOrganisation: { organisationId: 'owner' },
        extensions: [{ name: 'createdByUserId', value: 'director' }],
        updatedAt: 'record clock',
      },
    });
  }

  beforeAll(async () => {
    pool = new Pool(config);
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

  it('projects the shell fields with the parent revision, including after a parent-only update', async () => {
    await save('clocks');
    await shard('clocks');
    await pool.query(
      "UPDATE tournaments SET provider_id='decoy', updated_at='2001-01-01Z' WHERE tournament_id='clocks'",
    );
    const fallback = vi.fn(ordinary);
    const actual = await fetchPhysicalShellMetadata(pool, ['clocks'], fallback);
    expect(actual).toStrictEqual(await ordinary(['clocks']));
    expect(actual[0]).toMatchObject({
      providerId: 'owner',
      updatedAt: 'record clock',
      serverUpdatedAt: '2001-01-01T00:00:00.000Z',
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('delegates mixed, duplicate and empty batches intact, and singletons without a usable shell', async () => {
    await save('document');
    await save('physical');
    await shard('physical');
    // An orphan shell must never authorize a tournament whose layout is document.
    await pool.query("INSERT INTO tournament_shells(tournament_id,shell) VALUES ('document','{}')");
    const fallback = vi.fn(ordinary);
    for (const ids of [[], ['document', 'physical', 'absent'], ['physical', 'physical'], ['document'], ['absent']]) {
      fallback.mockClear();
      expect(await fetchPhysicalShellMetadata(pool, ids, fallback)).toStrictEqual(await ordinary(ids));
      expect(fallback.mock.calls).toEqual([[ids]]);
    }
    await pool.query("DELETE FROM tournament_shells WHERE tournament_id='physical'");
    fallback.mockClear();
    expect(await fetchPhysicalShellMetadata(pool, ['physical'], fallback)).toStrictEqual(await ordinary(['physical']));
    expect(fallback).toHaveBeenCalledOnce();
  });

  it.each([
    ['disabled', 'ALTER TABLE tournaments DISABLE TRIGGER tournaments_shard_sync'],
    ['replica only', 'ALTER TABLE tournaments ENABLE REPLICA TRIGGER tournaments_shard_sync'],
    ['missing', 'DROP TRIGGER tournaments_shard_sync ON tournaments'],
    [
      'insert only',
      'CREATE OR REPLACE TRIGGER tournaments_shard_sync AFTER INSERT ON tournaments FOR EACH ROW EXECUTE FUNCTION tournaments_shard_sync()',
    ],
  ])('reads the current document owner when the sync trigger is %s', async (_state, ddl) => {
    const id = 'trigger-' + _state;
    await save(id);
    await shard(id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(ddl);
      await client.query(
        "UPDATE tournaments SET data=jsonb_set(data, '{parentOrganisation,organisationId}', to_jsonb('new-owner'::text)) WHERE tournament_id=$1",
        [id],
      );
      const stale = await client.query(
        "SELECT shell->'parentOrganisation'->>'organisationId' AS owner FROM tournament_shells WHERE tournament_id=$1",
        [id],
      );
      expect(stale.rows[0].owner).toBe('owner');
      await commandTransaction.run({ pool, client, afterCommit: [] }, async () => {
        const fallback = vi.fn(ordinary);
        const result = await fetchPhysicalShellMetadata(pool, [id], fallback);
        expect(fallback.mock.calls).toEqual([[[id]]]);
        expect(result[0].providerId).toBe('new-owner');
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('uses the command client for physical rows and fallback; other pools see committed state', async () => {
    await save('transaction');
    await shard('transaction');
    const before = await read(['transaction']);
    const observer = new Pool(config);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "UPDATE tournaments SET data=data - 'parentOrganisation' - 'extensions' - 'updatedAt' WHERE tournament_id='transaction'",
      );
      await commandTransaction.run({ pool, client, afterCommit: [] }, async () => {
        const changed = await read(['transaction']);
        expect(changed).toStrictEqual(await ordinary(['transaction']));
        expect(changed[0]).toMatchObject({ providerId: null, updatedAt: null, extensions: [] });
        const other = new PostgresTournamentStorage(observer);
        expect(
          await fetchPhysicalShellMetadata(observer, ['transaction'], (ids) => other.fetchTournamentMetadata(ids)),
        ).toStrictEqual(before);
        await client.query("SELECT set_tournament_storage_layout('transaction', 'document')");
        const fallback = vi.fn(ordinary);
        expect(await fetchPhysicalShellMetadata(pool, ['transaction'], fallback)).toStrictEqual(changed);
        expect(fallback).toHaveBeenCalledOnce();
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await observer.end();
    }
    expect(await read(['transaction'])).toStrictEqual(before);
  });
});
