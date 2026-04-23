import { describe, it, expect } from 'vitest';
import { validateTournamentRecord } from '../validators/validateRecord.js';

function makeMinimalRecord(overrides?: any) {
  return {
    tournamentId: 't-1',
    tournamentName: 'Test Tournament',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    participants: [],
    events: [],
    ...overrides,
  };
}

describe('validateTournamentRecord', () => {
  describe('L1 — field presence', () => {
    it('passes a valid minimal record', async () => {
      let result: any = await validateTournamentRecord(makeMinimalRecord(), 'L1');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects null input', async () => {
      let result: any = await validateTournamentRecord(null, 'L1');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects missing tournamentId', async () => {
      let result: any = await validateTournamentRecord(makeMinimalRecord({ tournamentId: undefined }), 'L1');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing tournamentId');
    });

    it('rejects missing tournamentName', async () => {
      let result: any = await validateTournamentRecord(makeMinimalRecord({ tournamentName: undefined }), 'L1');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing tournamentName');
    });

    it('rejects bad date format', async () => {
      let result: any = await validateTournamentRecord(makeMinimalRecord({ startDate: '06/01/2026' }), 'L1');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e: string) => e.includes('YYYY-MM-DD'))).toBe(true);
    });

    it('rejects startDate after endDate', async () => {
      let result: any = await validateTournamentRecord(makeMinimalRecord({ startDate: '2026-06-05', endDate: '2026-06-01' }), 'L1');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e: string) => e.includes('before or equal'))).toBe(true);
    });

    it('rejects events as non-array', async () => {
      let result: any = await validateTournamentRecord(makeMinimalRecord({ events: 'not-an-array' }), 'L1');
      expect(result.valid).toBe(false);
    });
  });

  describe('L2 — engine round-trip', () => {
    it('passes a mocksEngine-generated record', async () => {
      const { mocksEngine, tournamentEngine } = await import('tods-competition-factory');
      mocksEngine.generateTournamentRecord({
        drawProfiles: [{ drawSize: 8 }],
        setState: true,
      });
      const { tournamentRecord } = tournamentEngine.getTournament();
      tournamentEngine.reset();

      let result: any = await validateTournamentRecord(tournamentRecord, 'L2');
      expect(result.valid).toBe(true);
    });

    it('warns about missing parentOrganisation', async () => {
      const { mocksEngine, tournamentEngine } = await import('tods-competition-factory');
      mocksEngine.generateTournamentRecord({
        drawProfiles: [{ drawSize: 4 }],
        setState: true,
      });
      const { tournamentRecord } = tournamentEngine.getTournament();
      tournamentEngine.reset();
      delete tournamentRecord.parentOrganisation;

      let result: any = await validateTournamentRecord(tournamentRecord, 'L2');
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w: string) => w.includes('parentOrganisation'))).toBe(true);
    });

    it('catches entry referencing unknown participantId', async () => {
      const record = makeMinimalRecord({
        participants: [{ participantId: 'p-1', participantType: 'INDIVIDUAL', participantRole: 'COMPETITOR', participantName: 'A' }],
        events: [{
          eventId: 'e-1',
          eventType: 'SINGLES',
          eventName: 'Singles',
          entries: [{ participantId: 'p-unknown', entryStatus: 'DIRECT_ACCEPTANCE' }],
          drawDefinitions: [],
        }],
      });

      let result: any = await validateTournamentRecord(record, 'L2');
      expect(result.errors.some((e: string) => e.includes('p-unknown'))).toBe(true);
    });
  });

  describe('L3 — deep domain', () => {
    it('passes a fully valid record at L3', async () => {
      const { mocksEngine, tournamentEngine } = await import('tods-competition-factory');
      mocksEngine.generateTournamentRecord({
        drawProfiles: [{ drawSize: 8 }],
        completeAllMatchUps: true,
        setState: true,
      });
      const { tournamentRecord } = tournamentEngine.getTournament();
      tournamentEngine.reset();

      let result: any = await validateTournamentRecord(tournamentRecord, 'L3');
      expect(result.valid).toBe(true);
    });
  });
});
