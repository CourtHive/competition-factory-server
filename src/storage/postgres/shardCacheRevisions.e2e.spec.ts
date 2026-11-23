import { ACTIVE_SHARD_CACHE_REVISIONS_SQL } from './shardCacheRevisionGuard';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';

const partTables = ['tournament_shells', 'draw_definitions', 'tournament_participants'];
const sql = (file: string) => readFileSync(join(__dirname, file), 'utf8');
const migration = sql('migrations/067-shard-cache-revisions.sql');
const fixture = (id: string) => ({
  tournamentId: id,
  participants: [{ participantId: 'p' }, { participantId: 'q' }],
  events: [{ eventId: 'e', drawDefinitions: [{ drawId: 'a' }, { drawId: 'b' }] }],
});

describe.skipIf(process.env.STORAGE_LAYOUT_DB_TESTS !== 'true')('shard cache revisions (real PostgreSQL)', () => {
  const schema = 'cache_rev_' + randomUUID().replace(/-/g, '');
  let db: Pool;
  const layout = (id: string, kind: string) => db.query('SELECT set_tournament_storage_layout($1,$2)', [id, kind]);
  const insert = (id: string) =>
    db.query('INSERT INTO tournaments(tournament_id,data) VALUES ($1,$2)', [id, fixture(id)]);
  const versions = async (id: string) =>
    (
      await db.query(
        `SELECT 's' AS part, cache_revision AS rev FROM tournament_shells WHERE tournament_id=$1
        UNION ALL SELECT 'd' || ord, cache_revision FROM draw_definitions WHERE tournament_id=$1
        UNION ALL SELECT 'p' || ord, cache_revision FROM tournament_participants WHERE tournament_id=$1 ORDER BY part`,
        [id],
      )
    ).rows;
  const heaps = async () =>
    (
      await db.query(
        `SELECT relname, pg_relation_filenode(oid) AS node FROM pg_class
    WHERE relnamespace = $1::regnamespace AND relname = ANY($2) ORDER BY relname`,
        [schema, partTables],
      )
    ).rows;
  let preMigrationHeaps: unknown;

  beforeAll(async () => {
    db = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT) || 5432,
      database: process.env.PG_DATABASE || 'courthive',
      user: process.env.PG_USER || process.env.USER,
      password: process.env.PG_PASSWORD || '',
      options: `-c search_path=${schema}`,
    });
    await db.query(`CREATE SCHEMA ${schema}`);
    for (const file of [
      'migrations/001-initial-schema.sql',
      'migrations/061-tournament-storage-layout.sql',
      'migrations/062-tournament-shards.sql',
      '../../scripts/sharding/enable-record-sharding.sql',
    ])
      await db.query(sql(file));
    await insert('old');
    await layout('old', 'sharded');
    preMigrationHeaps = await heaps();
    await db.query(migration);
  });
  afterAll(async () => {
    try {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await db.end();
    }
  });

  it('makes preexisting rows retainable by physical key without rewriting any heap or retaining an insert default', async () => {
    const before = await versions('old');
    expect(before).toHaveLength(5);
    expect(before.every((r) => typeof r.rev === 'string')).toBe(true);
    expect(new Set(before.map((r) => r.rev)).size).toBe(3);
    const attrs = await db.query(
      `SELECT atthasmissing, atthasdef FROM pg_attribute
      WHERE attname='cache_revision' AND attrelid = ANY($1::regclass[])`,
      [partTables],
    );
    expect(attrs.rows).toEqual(partTables.map(() => ({ atthasmissing: true, atthasdef: false })));
    await db.query(migration);
    expect(await versions('old')).toEqual(before);
    expect(await heaps()).toEqual(preMigrationHeaps);
  });

  it('runs physical row triggers only for inserts and changed parts, including with retention off', async () => {
    await insert('changes');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE TEMP TABLE revision_events (relation text, action text);
        CREATE FUNCTION count_events() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN INSERT INTO revision_events VALUES (TG_TABLE_NAME,TG_OP); RETURN NEW; END $$`);
      for (const table of partTables)
        await client.query(`CREATE TRIGGER count_events BEFORE INSERT OR UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION count_events()`);
      const events = async () => (await client.query('DELETE FROM revision_events RETURNING action,relation')).rows;
      const save = (expression: string) =>
        client.query(`UPDATE tournaments SET data=${expression} WHERE tournament_id='changes'`);
      await save('data');
      expect(await events()).toEqual([]);
      await client.query("SELECT set_tournament_storage_layout('changes','sharded')");
      const created = await events();
      expect(created).toHaveLength(5);
      expect(created.every((row) => row.action === 'INSERT')).toBe(true);
      await save('data');
      expect(await events()).toEqual([]);
      await save(`jsonb_set(data,'{events,0,drawDefinitions,1,drawName}','"changed"')`);
      expect(await events()).toEqual([{ action: 'UPDATE', relation: 'draw_definitions' }]);
      expect(
        (
          await client.query(
            "SELECT tournament_reassemble('changes')=data AS ok FROM tournaments WHERE tournament_id='changes'",
          )
        ).rows[0].ok,
      ).toBe(true);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('distinguishes repeated writes sharing xmin and updated_at, ignores replayed revisions, and respects commit and rollback', async () => {
    await insert('peer');
    await layout('peer', 'sharded');
    const originals = await versions('peer');
    expect(new Set(originals.map((r) => r.rev)).size).toBe(5);
    const client = await db.connect();
    const original = originals.find((r) => r.part === 'd0').rev;
    const edit = async (name: string) =>
      (
        await client.query(
          `UPDATE draw_definitions
      SET draw=jsonb_set(draw,'{drawName}',to_jsonb($1::text)), updated_at=now(), cache_revision=$2
      WHERE tournament_id='peer' AND ord=0 RETURNING cache_revision, xmin::text AS xid, updated_at`,
          [name, original],
        )
      ).rows[0];
    try {
      await client.query('BEGIN');
      const a = await edit('A'),
        b = await edit('B');
      expect(a.xid).toBe(b.xid);
      expect(a.updated_at).toEqual(b.updated_at);
      expect(new Set([original, a.cache_revision, b.cache_revision]).size).toBe(3);
      expect(await versions('peer')).toEqual(originals);
      await client.query('ROLLBACK');
      expect(await versions('peer')).toEqual(originals);
      await client.query('BEGIN');
      const committed = await edit('C');
      await client.query('COMMIT');
      expect(await versions('peer')).toEqual(
        originals.map((row) => (row.part === 'd0' ? { ...row, rev: committed.cache_revision } : row)),
      );
      await client.query('BEGIN');
      await client.query("DELETE FROM draw_definitions WHERE tournament_id='peer' AND ord=0");
      const restored = await client.query(
        `INSERT INTO draw_definitions(tournament_id,event_ord,ord,draw,cache_revision)
        VALUES ('peer',0,0,'{"drawId":"a"}',$1) RETURNING cache_revision`,
        [original],
      );
      expect([original, committed.cache_revision]).not.toContain(restored.rows[0].cache_revision);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const previous = await versions('peer');
    await layout('peer', 'document');
    await layout('peer', 'sharded');
    const retired = new Set(previous.map((row) => row.rev));
    expect((await versions('peer')).every((row) => !retired.has(row.rev))).toBe(true);
  });

  it('serializes competing parent writers that insert then edit the same physical draw', async () => {
    const id = 'competing';
    await insert(id);
    await layout(id, 'sharded');
    const first = await db.connect();
    const second = await db.connect();
    const change = (label: string) => JSON.stringify({ drawId: 'c', drawName: label });
    const sql =
      "UPDATE tournaments SET data=jsonb_set(data, '{events,0,drawDefinitions,2}',$2::jsonb) WHERE tournament_id=$1";
    try {
      await first.query('BEGIN');
      await first.query(sql, [id, change('first')]);
      const versionSql =
        "SELECT cache_revision,draw->>'drawName' AS name FROM draw_definitions WHERE tournament_id=$1 AND ord=2";
      const firstRow = (await first.query(versionSql, [id])).rows[0];
      await second.query('BEGIN');
      const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending = second.query(sql, [id, change('second')]).then(
        () => undefined,
        (error: Error) => error,
      );
      // Observe the real parent lock before releasing it; the second trigger runs on a committed predecessor.
      const deadline = Date.now() + 5000;
      while (!(await db.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS waiting', [pid])).rows[0].waiting) {
        if (Date.now() >= deadline) throw new Error('Second writer did not reach the parent lock');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect((await db.query(versionSql, [id])).rows).toHaveLength(0);
      await first.query('COMMIT');
      expect(await pending).toBeUndefined();
      const secondRow = (await second.query(versionSql, [id])).rows[0];
      expect(secondRow.name).toBe('second');
      expect(secondRow.cache_revision).not.toBe(firstRow.cache_revision);
      expect((await db.query(versionSql, [id])).rows[0]).toEqual(firstRow);
      await second.query('COMMIT');
      expect((await db.query(versionSql, [id])).rows[0]).toEqual(secondRow);
      expect(
        (await db.query('SELECT tournament_reassemble($1)=data AS ok FROM tournaments WHERE tournament_id=$1', [id]))
          .rows[0].ok,
      ).toBe(true);
    } finally {
      await first.query('ROLLBACK');
      await second.query('ROLLBACK');
      first.release();
      second.release();
    }
  });

  it('detects disabled or substituted revision triggers on every part relation', async () => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const active = async () =>
        (await client.query(`SELECT ${ACTIVE_SHARD_CACHE_REVISIONS_SQL} AS enabled`)).rows[0].enabled;
      expect(await active()).toBe(true);
      for (const table of partTables) {
        await client.query(`ALTER TABLE ${table} DISABLE TRIGGER shard_cache_revision`);
        expect(await active()).toBe(false);
        await client.query(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER shard_cache_revision`);
      }
      await client.query(`CREATE OR REPLACE TRIGGER shard_cache_revision BEFORE INSERT ON draw_definitions FOR EACH ROW EXECUTE FUNCTION stamp_shard_cache_revision();
        ALTER TABLE draw_definitions ENABLE ALWAYS TRIGGER shard_cache_revision`);
      expect(await active()).toBe(false);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
