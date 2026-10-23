import { mocksEngine, topicConstants } from 'tods-competition-factory';
import { Logger } from '@nestjs/common';
import {
  drawIdsFromNotice,
  drawIntegrityScanStats,
  drawScanner,
  MAX_PENDING_SCANS,
  MAX_TRACKED_DRAWS,
  resetDrawIntegrityMemory,
  scanDraw,
  scheduleDrawIntegrityScan,
  snapshotTouchedDraws,
} from './executionQueueIntegrity';

// constants and types
import { MAX_LOGGED_ISSUES } from './drawIntegrity';

// A factory-generated draw is the control: if the scan objects to what the factory itself produced, the scan (or this
// wiring) is wrong. Every negative case breaks exactly one thing in a fresh copy of it.
function linkedRecord(drawType = 'FIRST_MATCH_LOSER_CONSOLATION') {
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    drawProfiles: [{ drawSize: 16, drawType }],
    nonRandom: 1,
  });
  return structuredClone(tournamentRecord) as any;
}

function target(record = linkedRecord()) {
  const drawDefinition = record.events[0].drawDefinitions[0];
  return { tournamentId: record.tournamentId, drawId: drawDefinition.drawId, drawDefinition };
}

// A WINNER/LOSER link without `source.roundNumber`: LINK_MISSING_SOURCE_ROUND, error severity.
function breakRoundLink(drawDefinition: any, linkType = 'LOSER') {
  const link = drawDefinition.links.find((l: any) => l.linkType === linkType && l.source?.roundNumber);
  delete link.source.roundNumber;
  return link;
}

// A link whose target structure is not in the draw: DANGLING_LINK, error severity. Distinct per index.
function addDanglingLinks(drawDefinition: any, count: number) {
  const template = drawDefinition.links[0];
  for (let index = 0; index < count; index++) {
    drawDefinition.links.push({
      ...structuredClone(template),
      target: { ...template.target, structureId: `gone-${index}` },
    });
  }
}

const lines = (spy: any) =>
  spy.mock.calls.filter(([, context]) => context === 'DrawIntegrity').map(([line]) => JSON.parse(line));

const flushImmediates = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

describe('executionQueueIntegrity', () => {
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

  describe('drawIdsFromNotice', () => {
    it.each([
      [topicConstants.MODIFY_MATCHUP, [{ tournamentId: 't', drawId: 'd1', matchUp: { matchUpId: 'm' } }], ['d1']],
      [topicConstants.MODIFY_MATCHUP, [{ tournamentId: 't', matchUp: { drawId: 'd2' } }], ['d2']],
      [topicConstants.MODIFY_POSITION_ASSIGNMENTS, [{ drawId: 'd3', structureId: 's' }], ['d3']],
      [topicConstants.MODIFY_SEED_ASSIGNMENTS, [{ drawId: 'd4' }], ['d4']],
      [topicConstants.MODIFY_DRAW_DEFINITION, [{ drawDefinition: { drawId: 'd5' } }], ['d5']],
      [topicConstants.ADD_MATCHUPS, [{ matchUps: [{ drawId: 'd6' }, { drawId: 'd7' }, {}] }], ['d6', 'd7']],
      [topicConstants.DELETED_MATCHUP_IDS, [{ tournamentId: 't', matchUpIds: ['m1'] }], []],
      [topicConstants.MODIFY_TOURNAMENT_DETAIL, [{ tournamentId: 't' }], []],
    ])('%s names %j', (topic, params, expected) => {
      expect(drawIdsFromNotice(topic, params).touched).toEqual(expected);
    });

    it('returns a deleted draw as DELETED, never as touched', () => {
      expect(drawIdsFromNotice(topicConstants.DELETED_DRAW_IDS, [{ drawId: 'gone', tournamentId: 't' }])).toEqual({
        touched: [],
        deleted: ['gone'],
        added: [],
      });
    });

    it('returns a created draw as ADDED as well as touched', () => {
      const result = drawIdsFromNotice(topicConstants.ADD_DRAW_DEFINITION, [{ drawDefinition: { drawId: 'new' } }]);
      expect(result).toEqual({ touched: ['new'], deleted: [], added: ['new'] });
    });

    it('tolerates payloads that are not arrays, and entries that are not objects', () => {
      expect(drawIdsFromNotice(topicConstants.MODIFY_MATCHUP, { drawId: 'single' }).touched).toEqual(['single']);
      expect(drawIdsFromNotice(topicConstants.MODIFY_MATCHUP, [null, 'x', 3, { drawId: 7 }]).touched).toEqual([]);
      expect(drawIdsFromNotice(topicConstants.MODIFY_MATCHUP, undefined).touched).toEqual([]);
    });
  });

  describe('snapshotTouchedDraws', () => {
    it('targets the touched draws by REFERENCE, across every tournament of the mutation', () => {
      const first = linkedRecord();
      const second = linkedRecord('COMPASS');
      const firstDraw = first.events[0].drawDefinitions[0];
      const secondDraw = second.events[0].drawDefinitions[0];
      const batch = snapshotTouchedDraws({
        tournamentRecords: { [first.tournamentId]: first, [second.tournamentId]: second },
        touchedDrawIds: new Set([secondDraw.drawId, 'not-in-any-record']),
        addedDrawIds: new Set([secondDraw.drawId]),
        methods: [{ method: 'setMatchUpStatus' }, { method: 'setMatchUpStatus' }, { method: 'addDrawDefinition' }],
      });
      expect(batch?.methods).toEqual(['setMatchUpStatus', 'addDrawDefinition']);
      expect(batch?.draws).toHaveLength(1);
      expect(batch?.draws[0]).toMatchObject({
        tournamentId: second.tournamentId,
        drawId: secondDraw.drawId,
        added: true,
      });
      expect(batch?.draws[0].drawDefinition).toBe(secondDraw);
      expect(firstDraw).toBeDefined();
    });

    it('returns nothing when no draw was touched or deleted — a non-draw mutation costs nothing more', () => {
      const record = linkedRecord();
      const records = { [record.tournamentId]: record };
      expect(snapshotTouchedDraws({ tournamentRecords: records, touchedDrawIds: new Set() })).toBeUndefined();
      expect(snapshotTouchedDraws({ tournamentRecords: records })).toBeUndefined();
    });

    it('carries deletions even when nothing is left to scan', () => {
      const batch = snapshotTouchedDraws({ tournamentRecords: {}, deletedDrawIds: new Set(['gone']) });
      expect(batch).toEqual({ methods: [], draws: [], deleted: [{ drawId: 'gone' }] });
    });

    it.each([['off'], [' OFF ']])('DRAW_INTEGRITY_MODE=%j: takes nothing', (mode) => {
      process.env.DRAW_INTEGRITY_MODE = mode;
      const record = linkedRecord();
      const { drawId } = target(record);
      const batch = snapshotTouchedDraws({
        tournamentRecords: { [record.tournamentId]: record },
        touchedDrawIds: new Set([drawId]),
      });
      expect(batch).toBeUndefined();
    });

    it.each([['report'], ['enforce']])('DRAW_INTEGRITY_MODE=%s: takes the targets (report on this path)', (mode) => {
      process.env.DRAW_INTEGRITY_MODE = mode;
      const record = linkedRecord();
      const { drawId } = target(record);
      const batch = snapshotTouchedDraws({
        tournamentRecords: { [record.tournamentId]: record },
        touchedDrawIds: new Set([drawId]),
      });
      expect(batch?.draws.map((draw) => draw.drawId)).toEqual([drawId]);
    });

    it('never throws: a record that cannot be read is a failure of the check, not of the mutation', () => {
      const hostile = {
        get events() {
          throw new Error('unreadable');
        },
      };
      let batch: any = 'unset';
      expect(() => {
        batch = snapshotTouchedDraws({ tournamentRecords: { t: hostile }, touchedDrawIds: new Set(['d']) });
      }).not.toThrow();
      expect(batch).toBeUndefined();
      expect(drawIntegrityScanStats().failures).toBe(1);
      expect(lines(warn)).toEqual([expect.objectContaining({ event: 'draw-integrity-scan-failed', failures: 1 })]);
    });
  });

  describe('scanDraw: introduced / pre-existing / baseline', () => {
    it('first scan of a CLEAN draw logs nothing and starts tracking it', () => {
      scanDraw(target(), ['setMatchUpStatus']);
      expect(lines(warn)).toEqual([]);
      expect(lines(log)).toEqual([]);
      expect(drawIntegrityScanStats()).toMatchObject({ scans: 1, tracked: 1, baseline: 0, introduced: 0 });
    });

    it('first scan of a BROKEN draw logs its error findings once, as baseline', () => {
      const scanned = target();
      breakRoundLink(scanned.drawDefinition);
      scanDraw(scanned, ['setMatchUpStatus']);

      const [line] = lines(warn);
      expect(lines(warn)).toHaveLength(1);
      expect(line).toMatchObject({
        event: 'draw-integrity',
        source: 'executionQueue',
        mode: 'report',
        finding: 'baseline',
        tournamentId: scanned.tournamentId,
        drawId: scanned.drawId,
        methods: ['setMatchUpStatus'],
        issueTypes: ['LINK_MISSING_SOURCE_ROUND'],
      });
      expect(line.issues[0].fingerprint).toEqual(expect.any(String));
      expect(line.scanMs).toEqual(expect.any(Number));
    });

    it('a later mutation on the same broken draw logs PRE-EXISTING, once per draw — not introduced, not per mutation', () => {
      const scanned = target();
      breakRoundLink(scanned.drawDefinition);
      scanDraw(scanned, ['setMatchUpStatus']); // baseline
      warn.mockClear();

      scanDraw(scanned, ['setMatchUpStatus']);
      scanDraw(scanned, ['addMatchUpScheduleItems']);
      scanDraw(scanned, ['setMatchUpStatus']);
      expect(lines(warn)).toEqual([]); // nothing introduced
      expect(lines(log)).toEqual([
        expect.objectContaining({
          finding: 'pre-existing',
          drawId: scanned.drawId,
          methods: ['setMatchUpStatus'],
          issueTypes: ['LINK_MISSING_SOURCE_ROUND'],
        }),
      ]);
      expect(drawIntegrityScanStats()).toMatchObject({ baseline: 1, introduced: 0, preExisting: 1 });
    });

    it('a draw whose first findings were below error severity logs its pre-existing set once, at LOG', () => {
      const scanned = target();
      vi.spyOn(drawScanner, 'getDrawInconsistencies').mockReturnValue({
        success: true,
        inconsistencies: [{ issueType: 'W', severity: 'warning', message: 'w', fingerprint: 'fw' }],
      } as any);
      scanDraw(scanned, ['a']); // baseline: warnings are tracked but not logged
      scanDraw(scanned, ['b']);
      scanDraw(scanned, ['c']);
      expect(lines(warn)).toEqual([]);
      expect(lines(log)).toEqual([
        expect.objectContaining({ finding: 'pre-existing', drawId: scanned.drawId, methods: ['b'], warningCount: 1 }),
      ]);
    });

    it('a NEW finding on a tracked draw is INTRODUCED, naming the methods, with the pre-existing ones counted', () => {
      const scanned = target();
      breakRoundLink(scanned.drawDefinition, 'LOSER');
      scanDraw(scanned, ['setMatchUpStatus']); // baseline: one finding
      warn.mockClear();

      addDanglingLinks(scanned.drawDefinition, 1);
      scanDraw(scanned, ['attachConsolationStructures']);
      const introducedLines = lines(warn);
      expect(introducedLines).toHaveLength(1);
      expect(introducedLines[0]).toMatchObject({
        finding: 'introduced',
        source: 'executionQueue',
        drawId: scanned.drawId,
        methods: ['attachConsolationStructures'],
        issueTypes: ['DANGLING_LINK'],
        errorCount: 1,
      });
      expect(introducedLines[0].issues[0]).toMatchObject({
        issueType: 'DANGLING_LINK',
        severity: 'error',
        fingerprint: expect.any(String),
      });
      expect(drawIntegrityScanStats().introduced).toBe(1);
    });

    it('a clean draw that breaks is INTRODUCED, and fixing it reports nothing', () => {
      const record = linkedRecord();
      const scanned = target(record);
      scanDraw(scanned, ['setMatchUpStatus']); // clean baseline

      const broken = structuredClone(scanned.drawDefinition);
      breakRoundLink(broken);
      scanDraw({ ...scanned, drawDefinition: broken }, ['setMatchUpStatus']);
      expect(lines(warn)).toEqual([
        expect.objectContaining({ finding: 'introduced', issueTypes: ['LINK_MISSING_SOURCE_ROUND'], resolvedCount: 0 }),
      ]);
      warn.mockClear();

      scanDraw(scanned, ['repairMalformedLinks']); // the original, clean drawDefinition
      expect(lines(warn)).toEqual([]);
      expect(lines(log)).toEqual([]);
    });

    it('a draw this mutation CREATED has a known baseline — nothing — so its findings are introduced', () => {
      const scanned = target();
      breakRoundLink(scanned.drawDefinition);
      scanDraw({ ...scanned, added: true }, ['addDrawDefinition']);
      expect(lines(warn)).toEqual([
        expect.objectContaining({ finding: 'introduced', methods: ['addDrawDefinition'], drawId: scanned.drawId }),
      ]);
    });

    it('caps the issues carried in one line while keeping the counts exact (MAX_LOGGED_ISSUES)', () => {
      const scanned = target();
      scanDraw(scanned, ['x']); // clean baseline
      addDanglingLinks(scanned.drawDefinition, MAX_LOGGED_ISSUES + 5);
      scanDraw(scanned, ['y']);
      const [line] = lines(warn);
      expect(line.finding).toBe('introduced');
      expect(line.errorCount).toBeGreaterThan(MAX_LOGGED_ISSUES);
      expect(line.issues).toHaveLength(MAX_LOGGED_ISSUES);
      expect(line.truncated).toBe(true);
    });

    it('keeps at most MAX_TRACKED_DRAWS draws, forgetting the least recently scanned', () => {
      const clean = { success: true, inconsistencies: [] } as any;
      const scan = vi.spyOn(drawScanner, 'getDrawInconsistencies').mockReturnValue(clean);
      const draw = (index: number) => ({ tournamentId: 't', drawId: `d${index}`, drawDefinition: {} });

      for (let index = 0; index <= MAX_TRACKED_DRAWS; index++) scanDraw(draw(index), ['m']);
      expect(drawIntegrityScanStats()).toMatchObject({ tracked: MAX_TRACKED_DRAWS, evicted: 1 });

      // d0 was evicted, so a finding on it now is a baseline; d1 is still tracked, so the same finding is introduced.
      scan.mockReturnValue({
        success: true,
        inconsistencies: [{ issueType: 'E', severity: 'error', message: 'e', fingerprint: 'fe' }],
      } as any);
      // (d1 first: re-admitting d0 evicts the then least recently used draw, which would otherwise be d1.)
      scanDraw(draw(1), ['m']);
      scanDraw(draw(0), ['m']);
      expect(lines(warn).map((line) => [line.drawId, line.finding])).toEqual([
        ['d1', 'introduced'],
        ['d0', 'baseline'],
      ]);
      expect(drawIntegrityScanStats()).toMatchObject({ tracked: MAX_TRACKED_DRAWS, evicted: 2 });
    });
  });

  describe('scan failures never propagate', () => {
    it('a scan that THROWS is logged once, counted, and swallowed; recovery is logged', () => {
      const scan = vi.spyOn(drawScanner, 'getDrawInconsistencies').mockImplementation(() => {
        throw new Error('corrupt beyond reading');
      });
      const scanned = target();
      expect(() => scanDraw(scanned, ['m'])).not.toThrow();
      expect(() => scanDraw(scanned, ['m'])).not.toThrow();
      expect(drawIntegrityScanStats().failures).toBe(2);
      // first failure logged, the second throttled
      expect(lines(warn)).toEqual([
        expect.objectContaining({
          event: 'draw-integrity-scan-failed',
          failures: 1,
          drawId: scanned.drawId,
          message: expect.stringContaining('corrupt beyond reading'),
        }),
      ]);

      scan.mockRestore();
      scanDraw(scanned, ['m']);
      expect(lines(warn).at(-1)).toEqual({
        event: 'draw-integrity-scan-recovered',
        source: 'executionQueue',
        afterFailures: 2,
      });
    });

    it('a scan that returns an ERROR is a failure, not a clean draw — and is not remembered as one', () => {
      vi.spyOn(drawScanner, 'getDrawInconsistencies').mockReturnValue({ error: { code: 'ERR_X' } } as any);
      scanDraw(target(), ['m']);
      expect(drawIntegrityScanStats()).toMatchObject({ failures: 1, scans: 0, tracked: 0 });
      expect(lines(warn)[0].message).toContain('ERR_X');
    });

    it('a deferred scan that throws cannot reach the scheduler', async () => {
      vi.spyOn(drawScanner, 'getDrawInconsistencies').mockImplementation(() => {
        throw new Error('boom');
      });
      const scanned = target();
      expect(() => scheduleDrawIntegrityScan({ methods: ['m'], draws: [scanned], deleted: [] })).not.toThrow();
      await flushImmediates();
      expect(drawIntegrityScanStats().failures).toBe(1);
    });
  });

  describe('scheduleDrawIntegrityScan', () => {
    it('defers every scan: nothing is scanned synchronously', async () => {
      const scan = vi.spyOn(drawScanner, 'getDrawInconsistencies');
      scheduleDrawIntegrityScan({ methods: ['m'], draws: [target(), target()], deleted: [] });
      expect(scan).not.toHaveBeenCalled();
      expect(drawIntegrityScanStats().pending).toBe(2);
      await flushImmediates();
      expect(scan).toHaveBeenCalledTimes(2);
      expect(drawIntegrityScanStats().pending).toBe(0);
    });

    it('scans two batches touching the same draw in the order they were scheduled', async () => {
      const scanned = target();
      const broken = structuredClone(scanned.drawDefinition);
      breakRoundLink(broken);
      scheduleDrawIntegrityScan({ methods: ['first'], draws: [scanned], deleted: [] });
      scheduleDrawIntegrityScan({ methods: ['second'], draws: [{ ...scanned, drawDefinition: broken }], deleted: [] });
      await flushImmediates();
      // In order: clean baseline, then the break introduced by the SECOND batch. Reversed, it would read as a baseline.
      expect(lines(warn)).toEqual([expect.objectContaining({ finding: 'introduced', methods: ['second'] })]);
    });

    it('a deleted draw is forgotten, so a re-created drawId starts from a fresh baseline', async () => {
      const scanned = target();
      scanDraw(scanned, ['m']); // clean, tracked
      expect(drawIntegrityScanStats().tracked).toBe(1);
      scheduleDrawIntegrityScan({
        methods: ['deleteDrawDefinitions'],
        draws: [],
        deleted: [{ drawId: scanned.drawId }],
      });
      await flushImmediates();
      expect(drawIntegrityScanStats().tracked).toBe(0);
    });

    it(`sheds scans beyond MAX_PENDING_SCANS (${MAX_PENDING_SCANS}) and says so`, async () => {
      vi.spyOn(drawScanner, 'getDrawInconsistencies').mockReturnValue({ success: true, inconsistencies: [] } as any);
      const draws = Array.from({ length: MAX_PENDING_SCANS + 2 }, (_, index) => ({
        tournamentId: 't',
        drawId: `d${index}`,
        drawDefinition: {},
      }));
      scheduleDrawIntegrityScan({ methods: ['m'], draws, deleted: [] });
      expect(drawIntegrityScanStats()).toMatchObject({ pending: MAX_PENDING_SCANS, shed: 2 });
      expect(lines(warn)).toEqual([expect.objectContaining({ event: 'draw-integrity-scan-shed', shed: 1 })]);
      await flushImmediates();
      expect(drawIntegrityScanStats()).toMatchObject({ pending: 0, scans: MAX_PENDING_SCANS });
    });

    it('does nothing for an absent batch', () => {
      expect(() => scheduleDrawIntegrityScan(undefined)).not.toThrow();
      expect(drawIntegrityScanStats().pending).toBe(0);
    });
  });
});
