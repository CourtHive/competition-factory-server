import { checkDrawIntegrity, drawIntegrityMode, gateDrawIntegrity, MAX_LOGGED_ISSUES } from './drawIntegrity';
import { BadRequestException, Logger } from '@nestjs/common';
import { mocksEngine } from 'tods-competition-factory';

// A factory-generated record is the control: if the scan objects to what the factory itself produced, the scan (or
// this wiring) is wrong. Every negative case breaks exactly one thing in a fresh copy of it.
function linkedRecord(drawType = 'FIRST_MATCH_LOSER_CONSOLATION') {
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    drawProfiles: [{ drawSize: 16, drawType }],
    nonRandom: 1,
  });
  return structuredClone(tournamentRecord) as any;
}

// A WINNER/LOSER link without `source.roundNumber` loads, passes validateL2, and leaves progression nowhere to go.
function withRoundlessLink(drawType?: string) {
  const record = linkedRecord(drawType);
  const draw = record.events[0].drawDefinitions[0];
  const link = draw.links.find((l: any) => ['WINNER', 'LOSER'].includes(l.linkType) && l.source?.roundNumber);
  delete link.source.roundNumber;
  return { record, drawId: draw.drawId, structureId: link.source.structureId };
}

// The same person under a second participantId: the factory rates this a WARNING, not corruption.
function withDuplicatedIdentity() {
  const record = linkedRecord();
  const individual = record.participants.find((p: any) => p.participantType === 'INDIVIDUAL' && p.person?.personId);
  record.participants.push({ ...structuredClone(individual), participantId: 'second-identity' });
  return record;
}

describe('drawIntegrity', () => {
  const previousMode = process.env.DRAW_INTEGRITY_MODE;
  let warn: any;
  let debug: any;

  beforeEach(() => {
    delete process.env.DRAW_INTEGRITY_MODE;
    warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    debug = vi.spyOn(Logger, 'debug').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
    debug.mockRestore();
  });
  afterAll(() => {
    if (previousMode === undefined) delete process.env.DRAW_INTEGRITY_MODE;
    else process.env.DRAW_INTEGRITY_MODE = previousMode;
  });

  describe('drawIntegrityMode', () => {
    it('defaults to report — production records were never scanned, so enforcement is opt-in', () => {
      expect(drawIntegrityMode()).toBe('report');
    });

    it.each([
      ['enforce', 'enforce'],
      [' ENFORCE ', 'enforce'],
      ['off', 'off'],
      ['report', 'report'],
      ['enforcing', 'report'],
      ['', 'report'],
    ])('reads DRAW_INTEGRITY_MODE=%j as %s', (value, expected) => {
      process.env.DRAW_INTEGRITY_MODE = value;
      expect(drawIntegrityMode()).toBe(expected);
    });
  });

  describe('checkDrawIntegrity', () => {
    it.each(['FIRST_MATCH_LOSER_CONSOLATION', 'COMPASS', 'FEED_IN_CHAMPIONSHIP_TO_R16'])(
      'finds nothing in an uncorrupted %s draw',
      (drawType) => {
        const record = linkedRecord(drawType);
        expect(record.events[0].drawDefinitions[0].links.length).toBeGreaterThan(0);
        expect(checkDrawIntegrity(record)).toEqual({ errors: [], warnings: [] });
      },
    );

    it.each(['FIRST_MATCH_LOSER_CONSOLATION', 'COMPASS'])(
      'reports a %s round link with no source.roundNumber as an error, naming the draw and structure',
      (drawType) => {
        const { record, drawId, structureId } = withRoundlessLink(drawType);
        const { errors } = checkDrawIntegrity(record);
        expect(errors).toContainEqual(
          expect.objectContaining({ issueType: 'LINK_MISSING_SOURCE_ROUND', severity: 'error', drawId, structureId }),
        );
      },
    );

    it('reports a warning-severity finding as a warning, not an error', () => {
      const { errors, warnings } = checkDrawIntegrity(withDuplicatedIdentity());
      expect(errors).toEqual([]);
      expect(warnings.map((issue) => issue.issueType)).toContain('PARTICIPANT_IDENTITY_DUPLICATION');
    });

    it('fails closed when the scan cannot run', () => {
      const { errors } = checkDrawIntegrity(undefined);
      expect(errors).toEqual([expect.objectContaining({ issueType: 'INTEGRITY_SCAN_FAILED', severity: 'error' })]);
    });
  });

  describe('gateDrawIntegrity', () => {
    it('report: logs one structured WARN with the tournamentId and issues, and does not refuse', () => {
      const { record, drawId } = withRoundlessLink();
      expect(() => gateDrawIntegrity(record.tournamentId, record)).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      const [line, context] = warn.mock.calls[0];
      expect(context).toBe('DrawIntegrity');
      const payload = JSON.parse(line);
      expect(payload).toMatchObject({
        event: 'draw-integrity',
        mode: 'report',
        source: 'factory-save',
        tournamentId: record.tournamentId,
        truncated: false,
      });
      expect(payload.errorCount).toBeGreaterThan(0);
      expect(payload.issueTypes).toContain('LINK_MISSING_SOURCE_ROUND');
      expect(payload.issues).toContainEqual(
        expect.objectContaining({ issueType: 'LINK_MISSING_SOURCE_ROUND', drawId }),
      );
    });

    it('enforce: refuses an error-severity finding with a 400 naming the issue', () => {
      process.env.DRAW_INTEGRITY_MODE = 'enforce';
      const { record, drawId, structureId } = withRoundlessLink();
      let thrown: any;
      try {
        gateDrawIntegrity(record.tournamentId, record);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
      const body = thrown.getResponse();
      expect(body.tournamentId).toBe(record.tournamentId);
      expect(body.validationErrors.join(' ')).toContain('LINK_MISSING_SOURCE_ROUND');
      expect(body.validationErrors.join(' ')).toContain(`draw ${drawId} structure ${structureId}`);
      // The refusal is logged too, so report and enforce produce the same measurable line.
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('enforce: never refuses a record whose findings are all below error severity', () => {
      process.env.DRAW_INTEGRITY_MODE = 'enforce';
      const record = withDuplicatedIdentity();
      expect(() => gateDrawIntegrity(record.tournamentId, record)).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledTimes(1);
    });

    it('enforce: lets a clean record through silently', () => {
      process.env.DRAW_INTEGRITY_MODE = 'enforce';
      const record = linkedRecord();
      expect(() => gateDrawIntegrity(record.tournamentId, record)).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    });

    it('off: skips the scan entirely, even for a corrupted record', () => {
      process.env.DRAW_INTEGRITY_MODE = 'off';
      const { record } = withRoundlessLink();
      expect(() => gateDrawIntegrity(record.tournamentId, record)).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
    });

    it('bounds the issues carried in one line while keeping the counts exact', () => {
      const record = linkedRecord();
      const draw = record.events[0].drawDefinitions[0];
      const template = draw.links[0];
      for (let index = 0; index < MAX_LOGGED_ISSUES + 5; index++) {
        draw.links.push({ ...structuredClone(template), target: { ...template.target, structureId: `gone-${index}` } });
      }
      gateDrawIntegrity(record.tournamentId, record);
      const payload = JSON.parse(warn.mock.calls[0][0]);
      expect(payload.errorCount).toBeGreaterThan(MAX_LOGGED_ISSUES);
      expect(payload.issues).toHaveLength(MAX_LOGGED_ISSUES);
      expect(payload.truncated).toBe(true);
    });
  });
});
