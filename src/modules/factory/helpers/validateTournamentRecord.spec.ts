import { validateL1, validateL2, validateL3, validateTournamentRecord } from './validateTournamentRecord';
import { mocksEngine, syncEngine } from 'tods-competition-factory';

function makeMinimalRecord(overrides?: any) {
  return {
    tournamentId: 't-1',
    tournamentName: 'Test Tournament',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    ...overrides,
  };
}

// Generate a full record with draws and participants via mocksEngine.
// Uses setState: true so the engine is in a known state, then extracts
// the record. This avoids the singleton pollution issue where prior
// tests' setState calls with corrupted records affect generation.
function makeFullRecord() {
  syncEngine.reset();
  mocksEngine.generateTournamentRecord({
    drawProfiles: [{ drawSize: 8 }],
    setState: true,
  });
  const record = syncEngine.getTournament().tournamentRecord;
  syncEngine.reset();
  // mocksEngine doesn't always set tournamentName; ensure it's present
  record.tournamentName ??= 'Validation Test';
  return record;
}

describe('validateTournamentRecord', () => {
  describe('L1 — minimal field presence', () => {
    it('passes a valid minimal record', () => {
      let result: any = validateL1(makeMinimalRecord());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects null input', () => {
      let result: any = validateL1(null);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('must be an object');
    });

    it('rejects missing tournamentId', () => {
      let result: any = validateL1(makeMinimalRecord({ tournamentId: undefined }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('tournamentId is required');
    });

    it('rejects missing startDate', () => {
      let result: any = validateL1(makeMinimalRecord({ startDate: undefined }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('startDate is required');
    });

    it('rejects bad date format', () => {
      let result: any = validateL1(makeMinimalRecord({ startDate: '06/01/2026' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('startDate must be YYYY-MM-DD format');
    });

    it('rejects startDate after endDate', () => {
      let result: any = validateL1(makeMinimalRecord({ startDate: '2026-06-05', endDate: '2026-06-03' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('startDate must be before or equal to endDate');
    });

    it('rejects non-array events', () => {
      let result: any = validateL1(makeMinimalRecord({ events: 'not-an-array' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('events must be an array');
    });

    it('accumulates multiple errors', () => {
      let result: any = validateL1({ tournamentId: 't-1' });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });

  describe('L2 — engine round-trip', () => {
    it('passes a mocksEngine-generated record', () => {
      const record = makeFullRecord();
      let result: any = validateL2(record);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('warns when parentOrganisation is missing', () => {
      const record = makeFullRecord();
      delete record.parentOrganisation;
      let result: any = validateL2(record);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w: string) => w.includes('parentOrganisation'))).toBe(true);
    });

    it('catches event missing eventId', () => {
      const record = makeFullRecord();
      record.events.push({ eventType: 'SINGLES' });
      let result: any = validateL2(record);
      expect(result.errors.some((e: string) => e.includes('missing eventId'))).toBe(true);
    });

    it('catches event missing eventType', () => {
      const record = makeFullRecord();
      record.events.push({ eventId: 'e-bad' });
      let result: any = validateL2(record);
      expect(result.errors.some((e: string) => e.includes('missing eventType'))).toBe(true);
    });

    it('catches participant missing participantId', () => {
      const record = makeFullRecord();
      record.participants.push({ participantType: 'INDIVIDUAL' });
      let result: any = validateL2(record);
      expect(result.errors.some((e: string) => e.includes('missing participantId'))).toBe(true);
    });

    it('catches entry referencing unknown participantId', () => {
      const record = makeFullRecord();
      record.events[0].entries.push({ participantId: 'p-does-not-exist' });
      let result: any = validateL2(record);
      expect(result.errors.some((e: string) => e.includes('unknown participantId'))).toBe(true);
    });

    it('catches drawDefinition missing drawId', () => {
      const record = makeFullRecord();
      record.events[0].drawDefinitions.push({ structures: [] });
      let result: any = validateL2(record);
      expect(result.errors.some((e: string) => e.includes('missing drawId'))).toBe(true);
    });
  });

  describe('L3 — deep domain validation', () => {
    it('passes a valid complete record', () => {
      const record = makeFullRecord();
      let result: any = validateL3(record);
      expect(result.valid).toBe(true);
    });

    it('warns on invalid matchUpFormat', () => {
      const record = makeFullRecord();
      record.events[0].matchUpFormat = 'BOGUS-FORMAT';
      let result: any = validateL3(record);
      // May pass valid (formats are warnings not errors) but should warn
      expect(result.warnings.some((w: string) => w.includes('matchUpFormat'))).toBe(true);
    });
  });

  describe('validateTournamentRecord — level dispatch', () => {
    it('defaults to L2', () => {
      const record = makeFullRecord();
      let result: any = validateTournamentRecord(record);
      expect(result.valid).toBe(true);
    });

    it('respects L1 level', () => {
      let result: any = validateTournamentRecord(makeMinimalRecord(), 'L1');
      expect(result.valid).toBe(true);
    });

    it('respects L3 level', () => {
      const record = makeFullRecord();
      let result: any = validateTournamentRecord(record, 'L3');
      expect(result.valid).toBe(true);
    });
  });
});
