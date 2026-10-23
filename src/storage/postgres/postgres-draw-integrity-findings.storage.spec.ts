import { PostgresDrawIntegrityFindingsStorage } from './postgres-draw-integrity-findings.storage';
import { DrawIntegrityFindingsService } from 'src/modules/factory/helpers/drawIntegrityFindings';
import { mocksEngine } from 'tods-competition-factory';
import { getPostgresConfig } from './postgres.config';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  drawIntegrityScanStats,
  resetDrawIntegrityMemory,
  scheduleDrawIntegrityScan,
} from 'src/modules/factory/helpers/executionQueueIntegrity';

// constants and types
import type { DrawIntegrityFindingRow } from '../interfaces/draw-integrity-findings-storage.interface';

/**
 * `draw_integrity_findings` against a REAL Postgres (A11): migration 056, its premise guard, the writer's INSERT and
 * the seed's DISTINCT ON. The unit specs fake the sink, so this is the only place the SQL runs.
 *
 * Isolated schemas, as in commandReceipts.spec.ts: the shared suite's teardown cannot reach these rows, and these
 * tests cannot reach a real table.
 */

const MIGRATION = join(__dirname, 'migrations', '056-draw-integrity-findings.sql');

const row = (over: Partial<DrawIntegrityFindingRow> = {}): DrawIntegrityFindingRow => ({
  tournamentId: 't1',
  drawId: 'd1',
  event: 'baseline',
  code: 'DANGLING_LINK',
  severity: 'error',
  fingerprint: 'f1',
  methods: ['setMatchUpStatus'],
  observedAt: '2026-10-23T10:00:00.000Z',
  ...over,
});

function schemaPool(schema: string) {
  return new Pool({ ...getPostgresConfig(), options: `-c search_path=${schema}` });
}

/** Every scheduled scan has run, including any that waited on a seed read from the database. */
const flush = () =>
  vi.waitFor(() => expect(drawIntegrityScanStats()).toMatchObject({ pending: 0, seeding: 0 }), { timeout: 5000 });

describe('draw_integrity_findings (real Postgres)', () => {
  const schema = `findings_test_${randomUUID().split('-').join('')}`;
  let admin: Pool;
  let pool: Pool;
  let storage: PostgresDrawIntegrityFindingsStorage;
  let migration: string;

  beforeAll(async () => {
    admin = new Pool(getPostgresConfig());
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = schemaPool(schema);
    migration = await readFile(MIGRATION, 'utf8');
    await pool.query(migration);
    storage = new PostgresDrawIntegrityFindingsStorage(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE draw_integrity_findings');
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  describe('migration 056', () => {
    it('creates the table and both indexes in the schema it runs in, and re-running it is a no-op', async () => {
      await pool.query(migration);
      const indexes = await admin.query('SELECT indexname FROM pg_indexes WHERE schemaname = $1 ORDER BY 1', [schema]);
      expect(indexes.rows.map((index) => index.indexname)).toEqual([
        'draw_integrity_findings_pkey',
        'idx_draw_integrity_findings_draw',
        'idx_draw_integrity_findings_observed',
      ]);
    });

    it('rejects an event outside introduced | baseline | resolved', async () => {
      await expect(storage.append([row({ event: 'pre-existing' as any })])).rejects.toThrow(/event_check/);
    });

    it.each([
      ['missing columns', 'CREATE TABLE draw_integrity_findings (id BIGSERIAL PRIMARY KEY, draw_id TEXT)', /code:text/],
      [
        'a column of another type',
        `CREATE TABLE draw_integrity_findings (
           id BIGSERIAL PRIMARY KEY, observed_at TIMESTAMPTZ, tournament_id TEXT, draw_id TEXT, event TEXT, code TEXT,
           severity TEXT, fingerprint TEXT, structure_id TEXT, matchup_id TEXT, methods TEXT)`,
        /methods:ARRAY/,
      ],
    ])('REFUSES when a table of that name already exists with %s', async (_label, ddl, names) => {
      const other = `findings_premise_${randomUUID().split('-').join('')}`;
      await admin.query(`CREATE SCHEMA ${other}`);
      const otherPool = schemaPool(other);
      try {
        await otherPool.query(ddl);
        const refusal = otherPool.query(migration);
        await expect(refusal).rejects.toThrow(/REFUSING to continue/);
        await expect(refusal).rejects.toThrow(names);
      } finally {
        await otherPool.end();
        await admin.query(`DROP SCHEMA IF EXISTS ${other} CASCADE`);
      }
    });
  });

  describe('append + loadOpenFindings', () => {
    it('a draw with no rows is unknown', async () => {
      await expect(storage.loadOpenFindings('t1', 'd1')).resolves.toEqual({ known: false, open: [] });
    });

    it('writes every column it was given, and NULL for absent locations', async () => {
      await storage.append([
        row({ structureId: 's1', matchUpId: 'm1', methods: ['a', 'b'] }),
        row({ fingerprint: 'f2', methods: [] }),
      ]);
      const stored = await pool.query(
        `SELECT observed_at, tournament_id, draw_id, event, code, severity, fingerprint, structure_id, matchup_id, methods
           FROM draw_integrity_findings ORDER BY id`,
      );
      expect(stored.rows[0]).toEqual({
        observed_at: new Date('2026-10-23T10:00:00.000Z'),
        tournament_id: 't1',
        draw_id: 'd1',
        event: 'baseline',
        code: 'DANGLING_LINK',
        severity: 'error',
        fingerprint: 'f1',
        structure_id: 's1',
        matchup_id: 'm1',
        methods: ['a', 'b'],
      });
      expect(stored.rows[1]).toMatchObject({ structure_id: null, matchup_id: null, methods: [] });
    });

    it('the open set is the latest row per fingerprint that is not resolved', async () => {
      await storage.append([
        row({ fingerprint: 'stays', structureId: 's1' }),
        row({ fingerprint: 'fixed' }),
        row({ fingerprint: 'back' }),
      ]);
      await storage.append([
        row({ fingerprint: 'fixed', event: 'resolved', observedAt: '2026-10-23T11:00:00.000Z' }),
        row({ fingerprint: 'back', event: 'resolved', observedAt: '2026-10-23T11:00:00.000Z' }),
      ]);
      await storage.append([row({ fingerprint: 'back', event: 'introduced', observedAt: '2026-10-23T12:00:00.000Z' })]);

      const { known, open } = await storage.loadOpenFindings('t1', 'd1');
      expect(known).toBe(true);
      expect(open.map((finding) => finding.fingerprint).sort((a, b) => a.localeCompare(b))).toEqual(['back', 'stays']);
      expect(open.find((finding) => finding.fingerprint === 'stays')).toEqual({
        fingerprint: 'stays',
        code: 'DANGLING_LINK',
        severity: 'error',
        structureId: 's1',
        matchUpId: undefined,
      });
    });

    it('a draw whose findings were all resolved is KNOWN with an empty open set', async () => {
      await storage.append([row(), row({ event: 'resolved', observedAt: '2026-10-23T11:00:00.000Z' })]);
      await expect(storage.loadOpenFindings('t1', 'd1')).resolves.toEqual({ known: true, open: [] });
    });

    it.each([
      ['introduced then resolved', ['introduced', 'resolved'], []],
      ['resolved then introduced', ['resolved', 'introduced'], ['f1']],
    ])('the same observed_at is ordered by write order: %s', async (_label, sequence, expected) => {
      await storage.append(sequence.map((event) => row({ event: event as any })));
      const { open } = await storage.loadOpenFindings('t1', 'd1');
      expect(open.map((finding) => finding.fingerprint)).toEqual(expected);
    });

    it('reads one draw of one tournament only', async () => {
      await storage.append([row({ tournamentId: 't2' }), row({ drawId: 'd2' })]);
      await expect(storage.loadOpenFindings('t1', 'd1')).resolves.toEqual({ known: false, open: [] });
    });
  });

  // The weakness this table exists to fix, end to end through the real SQL: a deploy re-reported every broken draw
  // as `baseline`. Here the "deploy" is a fresh process state — LRU cleared, a new writer — over the same table.
  describe('restart durability, through the real table', () => {
    const previousMode = process.env.DRAW_INTEGRITY_MODE;
    beforeEach(() => {
      delete process.env.DRAW_INTEGRITY_MODE;
      resetDrawIntegrityMemory();
    });
    afterEach(() => vi.restoreAllMocks());
    afterAll(() => {
      resetDrawIntegrityMemory();
      if (previousMode === undefined) delete process.env.DRAW_INTEGRITY_MODE;
      else process.env.DRAW_INTEGRITY_MODE = previousMode;
    });

    it('a still-broken draw is not re-baselined after a restart; a new break on it is introduced', async () => {
      const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      vi.spyOn(Logger, 'log').mockImplementation(() => undefined);
      const { tournamentRecord } = mocksEngine.generateTournamentRecord({
        drawProfiles: [{ drawSize: 16, drawType: 'FIRST_MATCH_LOSER_CONSOLATION' }],
        nonRandom: 1,
      });
      const record: any = structuredClone(tournamentRecord);
      const drawDefinition = record.events[0].drawDefinitions[0];
      const link = drawDefinition.links.find((l: any) => l.linkType === 'LOSER' && l.source?.roundNumber);
      delete link.source.roundNumber; // LINK_MISSING_SOURCE_ROUND
      const target = { tournamentId: record.tournamentId, drawId: drawDefinition.drawId, drawDefinition };

      const before = new DrawIntegrityFindingsService(storage);
      scheduleDrawIntegrityScan({ methods: ['setMatchUpStatus'], draws: [target], deleted: [] }, before);
      await flush();
      await before.onModuleDestroy();

      resetDrawIntegrityMemory(); // the deploy
      warn.mockClear();
      const after = new DrawIntegrityFindingsService(storage);
      scheduleDrawIntegrityScan({ methods: ['setMatchUpStatus'], draws: [target], deleted: [] }, after);
      await flush();

      const findings = (line: any) => line.finding;
      const logged = () => warn.mock.calls.map(([line]) => JSON.parse(line)).filter(findings);
      expect(logged()).toEqual([]); // no baseline, nothing introduced

      const worse = structuredClone(drawDefinition);
      worse.links.push({ ...structuredClone(worse.links[0]), target: { ...worse.links[0].target, structureId: 'x' } });
      scheduleDrawIntegrityScan(
        { methods: ['attachConsolationStructures'], draws: [{ ...target, drawDefinition: worse }], deleted: [] },
        after,
      );
      await flush();
      await after.onModuleDestroy();
      expect(logged().map(findings)).toEqual(['introduced']);

      const stored = await pool.query('SELECT event, code, methods FROM draw_integrity_findings ORDER BY id');
      expect(stored.rows).toEqual([
        { event: 'baseline', code: 'LINK_MISSING_SOURCE_ROUND', methods: ['setMatchUpStatus'] },
        { event: 'introduced', code: 'DANGLING_LINK', methods: ['attachConsolationStructures'] },
      ]);
    });
  });
});
