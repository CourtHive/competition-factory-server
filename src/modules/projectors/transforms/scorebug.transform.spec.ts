import { buildScorebugPayload, deriveBoltState } from './scorebug.transform';
import {
  buildCompleteBoltHistory,
  buildMidBoltHistory,
  buildSampleBoltHistory,
} from '../fixtures/sample-bolt-history';

describe('scorebug.transform', () => {
  describe('deriveBoltState', () => {
    it('returns "pre" before bolt starts', () => {
      expect(deriveBoltState(buildSampleBoltHistory())).toBe('pre');
    });
    it('returns "play" once started', () => {
      expect(deriveBoltState(buildSampleBoltHistory({ boltStarted: true }))).toBe('play');
    });
    it('returns "paused" when paused on exit', () => {
      expect(
        deriveBoltState(buildSampleBoltHistory({ boltStarted: true, pausedOnExit: true })),
      ).toBe('paused');
    });
    it('returns "complete" when bolt is complete', () => {
      expect(deriveBoltState(buildCompleteBoltHistory())).toBe('complete');
    });
  });

  describe('buildScorebugPayload', () => {
    it('produces a pre-bolt payload', () => {
      const payload = buildScorebugPayload(buildSampleBoltHistory());
      expect(payload.matchUpId).toBe('tie-sample-1');
      expect(payload.format).toBe('INTENNSE');
      expect(payload.bolt.state).toBe('pre');
      expect(payload.matchUpStatus).toBe('IN_PROGRESS');
      expect(payload.side1.boltScore).toBe(0);
      expect(payload.side1.arcScore).toBe(0);
      expect(payload.side1.timeoutsRemaining).toBe(3);
      expect(payload.side2.timeoutsRemaining).toBe(3);
    });

    it('produces a mid-bolt payload with serving side identified', () => {
      const payload = buildScorebugPayload(buildMidBoltHistory());
      expect(payload.bolt.state).toBe('play');
      expect(payload.side1.boltScore).toBe(5);
      expect(payload.side2.boltScore).toBe(3);
      expect(payload.side1.isServing).toBe(true);
      expect(payload.side2.isServing).toBe(false);
      expect(payload.side1.timeoutsRemaining).toBe(2);
      expect(payload.side2.timeoutsRemaining).toBe(3);
    });

    it('produces a completed payload', () => {
      const payload = buildScorebugPayload(buildCompleteBoltHistory());
      expect(payload.bolt.state).toBe('complete');
      expect(payload.matchUpStatus).toBe('COMPLETED');
      expect(payload.side1.boltScore).toBe(21);
      expect(payload.side2.boltScore).toBe(18);
    });

    it('sets generatedAt as a parseable ISO timestamp', () => {
      const payload = buildScorebugPayload(buildSampleBoltHistory());
      expect(() => new Date(payload.generatedAt).toISOString()).not.toThrow();
    });
  });
});
