import { mocksEngine } from 'tods-competition-factory';
import { Logger } from '@nestjs/common';
import {
  drawIntegrityScanStats,
  drawScanner,
  resetDrawIntegrityMemory,
  scanDraw,
  scheduleDrawIntegrityScan,
} from './executionQueueIntegrity';

// constants and types
import type { DrawIntegrityFindingRow, DrawOpenFindings } from 'src/storage/interfaces';
import type { DrawIntegrityFindingsSink } from './executionQueueIntegrity';

/**
 * The executionQueue scan's PERSISTENCE (migration 056): which changes reach the findings sink, and how a draw this
 * process has forgotten is seeded back from it. The scan's log lines are pinned by executionQueueIntegrity.spec.ts;
 * the table itself by postgres-draw-integrity-findings.storage.spec.ts.
 */

function linkedRecord() {
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    drawProfiles: [{ drawSize: 16, drawType: 'FIRST_MATCH_LOSER_CONSOLATION' }],
    nonRandom: 1,
  });
  return structuredClone(tournamentRecord) as any;
}

function target(record = linkedRecord()) {
  const drawDefinition = record.events[0].drawDefinitions[0];
  return { tournamentId: record.tournamentId, drawId: drawDefinition.drawId, drawDefinition };
}

// LINK_MISSING_SOURCE_ROUND, error severity.
function breakRoundLink(drawDefinition: any) {
  const link = drawDefinition.links.find((l: any) => l.linkType === 'LOSER' && l.source?.roundNumber);
  delete link.source.roundNumber;
}

// DANGLING_LINK, error severity.
function addDanglingLink(drawDefinition: any) {
  const template = drawDefinition.links[0];
  drawDefinition.links.push({ ...structuredClone(template), target: { ...template.target, structureId: 'gone' } });
}

/** An in-memory sink: `rows` is everything recorded; `stored` answers the seed. */
function fakeSink(stored: Record<string, DrawOpenFindings> = {}) {
  const rows: DrawIntegrityFindingRow[] = [];
  const sink: DrawIntegrityFindingsSink & { rows: DrawIntegrityFindingRow[] } = {
    rows,
    record: vi.fn((recorded: DrawIntegrityFindingRow[]) => {
      rows.push(...recorded);
    }),
    loadOpen: vi.fn(async (tournamentId: string, drawId: string) => {
      return stored[`${tournamentId}:${drawId}`] ?? { known: false, open: [] };
    }),
  };
  return sink;
}

/** Turn the sink's rows into what the table would answer for a seed: latest row per fingerprint, not resolved. */
function asStored(rows: DrawIntegrityFindingRow[]): Record<string, DrawOpenFindings> {
  const latest = new Map<string, DrawIntegrityFindingRow>();
  for (const row of rows) latest.set(`${row.tournamentId}:${row.drawId}|${row.fingerprint}`, row);
  const stored: Record<string, DrawOpenFindings> = {};
  for (const [key, row] of latest) {
    const drawKey = key.split('|')[0];
    stored[drawKey] ??= { known: true, open: [] };
    if (row.event !== 'resolved') stored[drawKey].open.push(row);
  }
  return stored;
}

const lines = (spy: any) =>
  spy.mock.calls.filter(([, context]) => context === 'DrawIntegrity').map(([line]) => JSON.parse(line));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0)).then(() => new Promise(setImmediate));

const events = (rows: DrawIntegrityFindingRow[]) => rows.map((row) => [row.event, row.code]);

describe('executionQueueIntegrity — findings persistence', () => {
  const previousMode = process.env.DRAW_INTEGRITY_MODE;
  let warn: any;
  let log: any;

  beforeEach(() => {
    delete process.env.DRAW_INTEGRITY_MODE;
    resetDrawIntegrityMemory();
    warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    log = vi.spyOn(Logger, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => {
    if (previousMode === undefined) delete process.env.DRAW_INTEGRITY_MODE;
    else process.env.DRAW_INTEGRITY_MODE = previousMode;
  });

  describe('writes only CHANGES in a draw’s finding set', () => {
    it('a clean draw, scanned again and again, writes nothing', () => {
      const sink = fakeSink();
      const scanned = target();
      for (let index = 0; index < 3; index++) scanDraw(scanned, ['setMatchUpStatus'], sink);
      expect(sink.record).not.toHaveBeenCalled();
    });

    it('the first scan of a broken draw writes every finding as baseline — and the same set again writes nothing', () => {
      const sink = fakeSink();
      const scanned = target();
      breakRoundLink(scanned.drawDefinition);
      scanDraw(scanned, ['setMatchUpStatus'], sink);
      expect(events(sink.rows)).toEqual([['baseline', 'LINK_MISSING_SOURCE_ROUND']]);
      expect(sink.rows[0]).toMatchObject({
        tournamentId: scanned.tournamentId,
        drawId: scanned.drawId,
        severity: 'error',
        fingerprint: expect.any(String),
        methods: ['setMatchUpStatus'],
        observedAt: expect.any(String),
      });

      scanDraw(scanned, ['setMatchUpStatus'], sink);
      scanDraw(scanned, ['addMatchUpScheduleItems'], sink);
      expect(sink.record).toHaveBeenCalledTimes(1);
    });

    it('baseline carries warnings too, so a restart cannot read them back as introduced', () => {
      const sink = fakeSink();
      vi.spyOn(drawScanner, 'getDrawInconsistencies').mockReturnValue({
        success: true,
        inconsistencies: [{ issueType: 'W', severity: 'warning', message: 'w', fingerprint: 'fw' }],
      } as any);
      scanDraw(target(), ['m'], sink);
      expect(sink.rows.map((row) => [row.event, row.code, row.severity])).toEqual([['baseline', 'W', 'warning']]);
      expect(lines(warn)).toEqual([]); // the baseline LOG line stays error-only
    });

    it('a new finding is written as introduced, naming the methods; a fixed one as resolved, with its code', () => {
      const sink = fakeSink();
      const scanned = target();
      breakRoundLink(scanned.drawDefinition);
      scanDraw(scanned, ['setMatchUpStatus'], sink); // baseline
      const [baselineRow] = sink.rows;

      const worse = structuredClone(scanned.drawDefinition);
      addDanglingLink(worse);
      scanDraw({ ...scanned, drawDefinition: worse }, ['attachConsolationStructures'], sink);
      expect(events(sink.rows.slice(1))).toEqual([['introduced', 'DANGLING_LINK']]);
      expect(sink.rows[1].methods).toEqual(['attachConsolationStructures']);

      const repaired = target(); // the factory's own, clean draw, same ids
      scanDraw({ ...scanned, drawDefinition: repaired.drawDefinition }, ['repairMalformedLinks'], sink);
      expect(sink.rows.slice(2).map((row) => [row.event, row.code, row.fingerprint, row.methods])).toEqual(
        expect.arrayContaining([
          ['resolved', 'LINK_MISSING_SOURCE_ROUND', baselineRow.fingerprint, ['repairMalformedLinks']],
          ['resolved', 'DANGLING_LINK', sink.rows[1].fingerprint, ['repairMalformedLinks']],
        ]),
      );
      expect(sink.rows).toHaveLength(4);
    });

    it('a finding the factory could not fingerprint is persisted under a hash, never its message', () => {
      const sink = fakeSink();
      vi.spyOn(drawScanner, 'getDrawInconsistencies').mockReturnValue({
        success: true,
        inconsistencies: [{ issueType: 'X', severity: 'error', message: 'Jane Doe stands twice' }],
      } as any);
      scanDraw(target(), ['m'], sink);
      expect(sink.rows[0].fingerprint).toMatch(/^unfingerprinted:[0-9a-f]{32}$/);
      expect(JSON.stringify(sink.rows)).not.toContain('Jane');
    });

    it('a sink that throws is a counted failure of the check, never of the scan', () => {
      const sink = fakeSink();
      (sink.record as any).mockImplementation(() => {
        throw new Error('queue broken');
      });
      const scanned = target();
      breakRoundLink(scanned.drawDefinition);
      expect(() => scanDraw(scanned, ['m'], sink)).not.toThrow();
      expect(drawIntegrityScanStats()).toMatchObject({ failures: 1, baseline: 1, tracked: 1 });
    });
  });

  describe('restart durability: a forgotten draw is seeded from the table', () => {
    it('after a restart, a still-broken draw is PRE-EXISTING, not a new baseline, and writes nothing', async () => {
      const scanned = target();
      breakRoundLink(scanned.drawDefinition);
      const before = fakeSink();
      scheduleDrawIntegrityScan({ methods: ['setMatchUpStatus'], draws: [scanned], deleted: [] }, before);
      await flush();
      expect(events(before.rows)).toEqual([['baseline', 'LINK_MISSING_SOURCE_ROUND']]);

      resetDrawIntegrityMemory(); // the deploy
      warn.mockClear();
      const after = fakeSink(asStored(before.rows));
      scheduleDrawIntegrityScan({ methods: ['setMatchUpStatus'], draws: [scanned], deleted: [] }, after);
      await flush();

      expect(after.loadOpen).toHaveBeenCalledWith(scanned.tournamentId, scanned.drawId);
      expect(lines(warn)).toEqual([]);
      expect(lines(log)).toEqual([expect.objectContaining({ finding: 'pre-existing', drawId: scanned.drawId })]);
      expect(after.rows).toEqual([]);
      expect(drawIntegrityScanStats()).toMatchObject({ seeded: 1, baseline: 0, introduced: 0, pending: 0 });
    });

    it('after a restart, a NEW finding on a known draw is INTRODUCED — the alerting case', async () => {
      const scanned = target();
      breakRoundLink(scanned.drawDefinition);
      const stored = fakeSink();
      scanDraw(scanned, ['setMatchUpStatus'], stored);

      resetDrawIntegrityMemory();
      warn.mockClear(); // the baseline line above
      const worse = structuredClone(scanned.drawDefinition);
      addDanglingLink(worse);
      const after = fakeSink(asStored(stored.rows));
      scheduleDrawIntegrityScan(
        { methods: ['m2'], draws: [{ ...scanned, drawDefinition: worse }], deleted: [] },
        after,
      );
      await flush();
      expect(events(after.rows)).toEqual([['introduced', 'DANGLING_LINK']]);
      expect(lines(warn)).toEqual([expect.objectContaining({ finding: 'introduced', issueTypes: ['DANGLING_LINK'] })]);
    });

    it('a draw whose findings were all resolved is known: its next finding is introduced, not baseline', async () => {
      const scanned = target();
      breakRoundLink(scanned.drawDefinition);
      const after = fakeSink({ [`${scanned.tournamentId}:${scanned.drawId}`]: { known: true, open: [] } });
      scheduleDrawIntegrityScan({ methods: ['m'], draws: [scanned], deleted: [] }, after);
      await flush();
      expect(events(after.rows)).toEqual([['introduced', 'LINK_MISSING_SOURCE_ROUND']]);
    });

    it('a finding open in the table and gone now is written as resolved', async () => {
      const scanned = target(); // clean
      const key = `${scanned.tournamentId}:${scanned.drawId}`;
      const open = [{ fingerprint: 'f-old', code: 'DANGLING_LINK', severity: 'error', structureId: 's1' }];
      const after = fakeSink({ [key]: { known: true, open } });
      scheduleDrawIntegrityScan({ methods: ['repairMalformedLinks'], draws: [scanned], deleted: [] }, after);
      await flush();
      expect(after.rows).toEqual([
        expect.objectContaining({
          event: 'resolved',
          fingerprint: 'f-old',
          code: 'DANGLING_LINK',
          structureId: 's1',
          methods: ['repairMalformedLinks'],
        }),
      ]);
    });

    it('only a draw the table has never recorded is a baseline', async () => {
      const scanned = target();
      breakRoundLink(scanned.drawDefinition);
      const sink = fakeSink();
      scheduleDrawIntegrityScan({ methods: ['m'], draws: [scanned], deleted: [] }, sink);
      await flush();
      expect(sink.loadOpen).toHaveBeenCalledTimes(1);
      expect(events(sink.rows)).toEqual([['baseline', 'LINK_MISSING_SOURCE_ROUND']]);
      expect(lines(warn)).toEqual([expect.objectContaining({ finding: 'baseline' })]);
    });

    it('reads a draw back once: a remembered draw is classified without a read', async () => {
      const scanned = target();
      const sink = fakeSink();
      scheduleDrawIntegrityScan({ methods: ['m'], draws: [scanned], deleted: [] }, sink);
      await flush();
      scheduleDrawIntegrityScan({ methods: ['m'], draws: [scanned], deleted: [] }, sink);
      await flush();
      expect(sink.loadOpen).toHaveBeenCalledTimes(1);
    });

    it('a draw this mutation CREATED is never read back: its findings are introduced', async () => {
      const scanned = target();
      breakRoundLink(scanned.drawDefinition);
      const sink = fakeSink();
      scheduleDrawIntegrityScan(
        { methods: ['addDrawDefinition'], draws: [{ ...scanned, added: true }], deleted: [] },
        sink,
      );
      await flush();
      expect(sink.loadOpen).not.toHaveBeenCalled();
      expect(events(sink.rows)).toEqual([['introduced', 'LINK_MISSING_SOURCE_ROUND']]);
    });

    it('scans of one draw keep mutation order while its read is in flight', async () => {
      const scanned = target();
      const broken = structuredClone(scanned.drawDefinition);
      breakRoundLink(broken);
      let release: (value: DrawOpenFindings) => void = () => undefined;
      const sink = fakeSink();
      (sink.loadOpen as any).mockImplementation(() => new Promise((resolve) => (release = resolve)));

      scheduleDrawIntegrityScan({ methods: ['first'], draws: [scanned], deleted: [] }, sink);
      scheduleDrawIntegrityScan(
        { methods: ['second'], draws: [{ ...scanned, drawDefinition: broken }], deleted: [] },
        sink,
      );
      await flush();
      expect(drawIntegrityScanStats()).toMatchObject({ pending: 2, seeding: 1, scans: 0 }); // both wait on the read
      expect(sink.loadOpen).toHaveBeenCalledTimes(1);

      release({ known: true, open: [] });
      await flush();
      // In order: clean first, then the break the SECOND mutation made. Reversed, the second would read as resolved.
      expect(events(sink.rows)).toEqual([['introduced', 'LINK_MISSING_SOURCE_ROUND']]);
      expect(sink.rows[0].methods).toEqual(['second']);
      expect(drawIntegrityScanStats()).toMatchObject({ pending: 0, seeding: 0, scans: 2 });
    });

    it('a failed read falls back to baseline, is counted and logged once, and its recovery is logged', async () => {
      const scanned = target();
      breakRoundLink(scanned.drawDefinition);
      const sink = fakeSink();
      (sink.loadOpen as any).mockRejectedValue(new Error('connection refused'));
      // nonRandom mocks share ids: give the second draw its own, so it needs its own read.
      const other = { ...target(), drawId: 'other-draw' };
      scheduleDrawIntegrityScan({ methods: ['m'], draws: [scanned, other], deleted: [] }, sink);
      await flush();

      expect(drawIntegrityScanStats()).toMatchObject({ seedFailures: 2, baseline: 1, scans: 2, pending: 0 });
      expect(events(sink.rows)).toEqual([['baseline', 'LINK_MISSING_SOURCE_ROUND']]);
      const seedLines = lines(warn).filter((line) => line.event?.startsWith('draw-integrity-seed'));
      expect(seedLines).toEqual([
        expect.objectContaining({ event: 'draw-integrity-seed-failed', seedFailures: 1, drawId: scanned.drawId }),
      ]);

      (sink.loadOpen as any).mockResolvedValue({ known: false, open: [] });
      scheduleDrawIntegrityScan({ methods: ['m'], draws: [{ ...target(), drawId: 'third-draw' }], deleted: [] }, sink);
      await flush();
      expect(lines(warn).at(-1)).toEqual({
        event: 'draw-integrity-seed-recovered',
        source: 'executionQueue',
        afterFailures: 2,
      });
    });
  });
});
