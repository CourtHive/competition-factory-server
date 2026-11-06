import { mocksEngine, tournamentEngine } from 'tods-competition-factory';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

import { PostgresTournamentStorage } from './postgres-tournament.storage';

/**
 * Optional record sharding, dual-write stage (migration 062 and src/scripts/sharding), against a REAL Postgres.
 *
 * What it proves: sharding stays off until an operator enables it; a tournament set to `sharded` reassembles to its
 * record byte for byte, for every draw type the factory generates (round robin groups, TEAM tieMatchUps, AD_HOC,
 * absent keys); every later write keeps the shards equal and touches only the rows that changed; the match_up_index
 * holds every matchUp; deleting the tournament or returning it to `document` drops its shards; and a `document`
 * tournament is never sharded, trigger or not.
 *
 * Opt-in: skipped unless STORAGE_LAYOUT_DB_TESTS=true, because CI has no Postgres. Built from the migration files in a
 * scratch schema, so no real `tournaments` row is in reach:
 *
 *   STORAGE_LAYOUT_DB_TESTS=true PGGSSENCMODE=disable pnpm test -- storageShards
 */

const RUN = process.env.STORAGE_LAYOUT_DB_TESTS === 'true';
const d = RUN ? describe : describe.skip;
const SCHEMA = 'storage_shards_062_test';
const migration = (file: string) => readFileSync(join(__dirname, 'migrations', file), 'utf8');
const script = (file: string) => readFileSync(join(__dirname, '../../scripts/sharding', file), 'utf8');

const generate = (drawProfiles: any[], extra: any = {}) =>
  mocksEngine.generateTournamentRecord({ drawProfiles, completeAllMatchUps: true, ...extra }).tournamentRecord;

const RECORDS: Record<string, () => any> = {
  elimination: () => generate([{ drawSize: 16 }, { drawSize: 8, drawType: 'FEED_IN_CHAMPIONSHIP' }]),
  roundRobinWithPlayoff: () => generate([{ drawSize: 16, drawType: 'ROUND_ROBIN_WITH_PLAYOFF' }]),
  team: () => generate([{ drawSize: 4, eventType: 'TEAM', tieFormatName: 'COLLEGE_D3' }]),
  adHoc: () => generate([{ drawSize: 8, drawType: 'AD_HOC', automated: true, roundsCount: 2 }]),
  doubles: () => generate([{ drawSize: 8, eventType: 'DOUBLES' }]),
};

d('optional record sharding, dual-write (real Postgres)', () => {
  let pool: Pool;
  let storage: PostgresTournamentStorage;

  const one = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows[0];
  const drift = async () => (await pool.query('SELECT tournament_id FROM tournament_shard_drift')).rows;
  const reassembled = async (id: string) => (await one('SELECT tournament_reassemble($1) AS r', [id])).r;
  const shardCount = async (id: string) =>
    one(
      `SELECT (SELECT count(*)::int FROM tournament_shells WHERE tournament_id = $1) AS shells,
              (SELECT count(*)::int FROM draw_definitions WHERE tournament_id = $1) AS draws,
              (SELECT count(*)::int FROM tournament_participants WHERE tournament_id = $1) AS participants,
              (SELECT count(*)::int FROM match_up_index WHERE tournament_id = $1) AS match_ups`,
      [id],
    );
  const save = async (tournamentRecord: any) => {
    const result: any = await storage.saveTournamentRecord({ tournamentRecord });
    expect(result.success).toBe(true);
  };

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
      '062-tournament-shards.sql',
    ]) {
      await pool.query(migration(file));
    }
    storage = new PostgresTournamentStorage(pool as any);
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool?.end();
  });

  it('062 is idempotent', async () => {
    await pool.query(migration('062-tournament-shards.sql'));
  });

  it('refuses to shard a tournament until sharding is enabled', async () => {
    const record = RECORDS.elimination();
    await save(record);
    await expect(
      pool.query("SELECT set_tournament_storage_layout($1, 'sharded')", [record.tournamentId]),
    ).rejects.toThrow(/record sharding is not enabled/);
    expect(await shardCount(record.tournamentId)).toEqual({ shells: 0, draws: 0, participants: 0, match_ups: 0 });
  });

  describe('with sharding enabled', () => {
    beforeAll(async () => {
      await pool.query(script('enable-record-sharding.sql'));
      await pool.query(script('enable-record-sharding.sql')); // idempotent
    });

    it.each(Object.keys(RECORDS))('%s: reassembles to its record, and indexes every matchUp', async (name) => {
      const record = RECORDS[name]();
      await save(record);
      const { set_tournament_storage_layout } = await one("SELECT set_tournament_storage_layout($1, 'sharded')", [
        record.tournamentId,
      ]);
      expect(set_tournament_storage_layout).toBe('sharded');
      expect(await reassembled(record.tournamentId)).toEqual(record);

      tournamentEngine.setState(record);
      const matchUps: any[] = tournamentEngine.allTournamentMatchUps({ inContext: false }).matchUps ?? [];
      // not vacuous: the TEAM record's collection lines (tieMatchUps) are among those indexed
      if (name === 'team') expect(matchUps.filter(({ collectionId }: any) => collectionId).length).toBeGreaterThan(0);
      const matchUpIds = matchUps.map(({ matchUpId }: any) => matchUpId).sort();
      const indexed = (
        await pool.query('SELECT match_up_id FROM match_up_index WHERE tournament_id = $1 ORDER BY match_up_id', [
          record.tournamentId,
        ])
      ).rows.map(({ match_up_id }) => match_up_id);
      expect(indexed.length).toBeGreaterThan(0);
      expect(indexed).toEqual(matchUpIds);
      expect(await drift()).toEqual([]);
    });

    it('absent and empty arrays reassemble as they were', async () => {
      const bare = { tournamentId: 'bare', parentOrganisation: { organisationId: 'p' } };
      const empty = { ...bare, tournamentId: 'empty', participants: [], events: [{ eventId: 'e' }] };
      for (const record of [bare, empty]) {
        await save(record);
        await pool.query("SELECT set_tournament_storage_layout($1, 'sharded')", [record.tournamentId]);
        expect(await reassembled(record.tournamentId)).toEqual(record);
      }
      expect(await drift()).toEqual([]);
    });

    it('a later save keeps the shards equal and rewrites only the draw that changed', async () => {
      const record = RECORDS.elimination();
      await save(record);
      await pool.query("SELECT set_tournament_storage_layout($1, 'sharded')", [record.tournamentId]);
      const versions = async () =>
        (
          await pool.query(
            `SELECT 'draw:' || draw_id AS k, xmin::text AS v FROM draw_definitions WHERE tournament_id = $1
             UNION ALL SELECT 'participants', max(xmin::text) FROM tournament_participants WHERE tournament_id = $1`,
            [record.tournamentId],
          )
        ).rows.reduce((acc, { k, v }) => ({ ...acc, [k]: v }), {});
      const before = await versions();

      tournamentEngine.setState(record);
      const [drawA] = record.events[0].drawDefinitions;
      // the final: nothing depends on it, so its score can be removed
      const target: any = (tournamentEngine.allTournamentMatchUps({ inContext: true }).matchUps ?? [])
        .filter(({ drawId }: any) => drawId === drawA.drawId)
        .sort((a: any, b: any) => b.roundNumber - a.roundNumber)[0];
      let result: any = tournamentEngine.setMatchUpStatus({
        matchUpId: target.matchUpId,
        drawId: drawA.drawId,
        outcome: { matchUpStatus: 'TO_BE_PLAYED' },
      });
      expect(result.success).toBe(true);
      result = tournamentEngine.getTournament();
      await save(result.tournamentRecord);

      expect(await reassembled(record.tournamentId)).toEqual(result.tournamentRecord);
      expect(await drift()).toEqual([]);
      const after = await versions();
      const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
      expect(changed).toEqual([`draw:${drawA.drawId}`]);
    });

    it('a document tournament is never sharded', async () => {
      const record = RECORDS.doubles();
      await save(record);
      await save({ ...record, tournamentName: 'renamed' });
      expect(await shardCount(record.tournamentId)).toEqual({ shells: 0, draws: 0, participants: 0, match_ups: 0 });
    });

    it('returning to document, or deleting the tournament, drops its shards', async () => {
      const kept = RECORDS.adHoc();
      const deleted = RECORDS.adHoc();
      for (const record of [kept, deleted]) {
        await save(record);
        await pool.query("SELECT set_tournament_storage_layout($1, 'sharded')", [record.tournamentId]);
        expect((await shardCount(record.tournamentId)).shells).toBe(1);
      }

      await pool.query("SELECT set_tournament_storage_layout($1, 'document')", [kept.tournamentId]);
      expect(await shardCount(kept.tournamentId)).toEqual({ shells: 0, draws: 0, participants: 0, match_ups: 0 });
      expect(await storage.fetchStorageLayouts({ tournamentIds: [kept.tournamentId] })).toEqual({
        [kept.tournamentId]: 'document',
      });

      await storage.removeTournamentRecords({ tournamentId: deleted.tournamentId });
      expect(await shardCount(deleted.tournamentId)).toEqual({ shells: 0, draws: 0, participants: 0, match_ups: 0 });
      expect(
        (
          await one('SELECT count(*)::int AS n FROM tournament_storage_layout WHERE tournament_id = $1', [
            deleted.tournamentId,
          ])
        ).n,
      ).toBe(0);
    });

    it('the drift view catches shards that disagree with their record', async () => {
      const record = RECORDS.elimination();
      await save(record);
      await pool.query("SELECT set_tournament_storage_layout($1, 'sharded')", [record.tournamentId]);
      await pool.query(
        'UPDATE tournament_shells SET shell = shell || \'{"tournamentName":"tampered"}\' WHERE tournament_id = $1',
        [record.tournamentId],
      );
      expect(await drift()).toEqual([{ tournament_id: record.tournamentId }]);
      await save(record); // the next write re-derives the shell
      expect(await drift()).toEqual([]);
    });

    it('disabling returns every tournament to document and removes the trigger', async () => {
      await pool.query(script('disable-record-sharding.sql'));
      expect((await one("SELECT count(*)::int AS n FROM tournament_storage_layout WHERE layout = 'sharded'")).n).toBe(
        0,
      );
      expect((await one('SELECT count(*)::int AS n FROM tournament_shells')).n).toBe(0);
      expect(
        (
          await one(
            "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'tournaments_shard_sync' AND NOT tgisinternal",
          )
        ).n,
      ).toBe(0);
    });
  });
});
