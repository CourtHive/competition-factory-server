import { buildPublicLivePayload } from './public-live.transform';
import {
  buildCompleteBoltHistory,
  buildMidBoltHistory,
  buildSampleBoltHistory,
  buildStandardMidMatchHistory,
} from '../fixtures/sample-bolt-history';

describe('public-live.transform', () => {
  describe('buildPublicLivePayload', () => {
    it('builds a pre-bolt INTENNSE payload with empty set scores', () => {
      const payload = buildPublicLivePayload(
        buildSampleBoltHistory({
          matchUpFormat: 'SET3-S:T7XA-S:T10P',
          competitionFormat: { sport: 'INTENNSE' },
        }),
      );
      expect(payload.format).toBe('INTENNSE');
      expect(payload.status).toBe('pre');
      expect(payload.side1.setScores).toEqual([]);
      expect(payload.side2.setScores).toEqual([]);
      expect(payload.intennseBolt?.state).toBe('pre');
      expect(payload.intennseBolt?.number).toBe(1);
    });

    it('builds an in-progress INTENNSE payload with set scores and serving side', () => {
      const payload = buildPublicLivePayload(buildMidBoltHistory());
      expect(payload.format).toBe('INTENNSE');
      expect(payload.status).toBe('in_progress');
      expect(payload.side1.setScores).toEqual([5]);
      expect(payload.side2.setScores).toEqual([3]);
      expect(payload.side1.gameScore).toBe(2);
      expect(payload.side2.gameScore).toBe(1);
      expect(payload.side1.isServing).toBe(true);
      expect(payload.side2.isServing).toBe(false);
      expect(payload.intennseBolt?.state).toBe('play');
      expect(payload.intennseBolt?.boltClockMs).toBe(420000);
      expect(payload.intennseBolt?.serveClockMs).toBe(18000);
    });

    it('builds a completed INTENNSE payload', () => {
      const payload = buildPublicLivePayload(buildCompleteBoltHistory());
      expect(payload.status).toBe('completed');
      expect(payload.intennseBolt?.state).toBe('complete');
    });

    it('builds a STANDARD format payload without intennseBolt', () => {
      const payload = buildPublicLivePayload(buildStandardMidMatchHistory());
      expect(payload.format).toBe('STANDARD');
      expect(payload.intennseBolt).toBeUndefined();
      expect(payload.side1.setScores).toEqual([6, 3]);
      expect(payload.side2.setScores).toEqual([4, 5]);
      expect(payload.side2.isServing).toBe(true);
    });

    it('strips per-point history from the payload (no points field)', () => {
      const payload = buildPublicLivePayload(buildMidBoltHistory());
      // The payload type does not have a points array; this is a structural assertion
      expect((payload as any).points).toBeUndefined();
      expect((payload as any).engineState).toBeUndefined();
    });

    it('always includes matchUpId and tournamentId', () => {
      const payload = buildPublicLivePayload(buildMidBoltHistory());
      expect(payload.matchUpId).toBe('tie-sample-1');
      expect(payload.tournamentId).toBe('tour-sample-1');
    });

    it('emits a parseable generatedAt timestamp', () => {
      const payload = buildPublicLivePayload(buildMidBoltHistory());
      expect(() => new Date(payload.generatedAt).toISOString()).not.toThrow();
    });
  });
});
