import { buildMatchUpFinalizedPayload, isFinalizingNotice } from './matchup-finalized.transform';

describe('matchup-finalized.transform', () => {
  describe('isFinalizingNotice', () => {
    it('returns true when winningSide is 1', () => {
      expect(isFinalizingNotice({ matchUp: { matchUpId: 'm1', winningSide: 1 } })).toBe(true);
    });

    it('returns true when winningSide is 2', () => {
      expect(isFinalizingNotice({ matchUp: { matchUpId: 'm1', winningSide: 2 } })).toBe(true);
    });

    it('returns true when matchUpStatus is COMPLETED', () => {
      expect(isFinalizingNotice({ matchUp: { matchUpId: 'm1', matchUpStatus: 'COMPLETED' } })).toBe(true);
    });

    it('returns true when both winningSide and COMPLETED are present', () => {
      expect(
        isFinalizingNotice({ matchUp: { matchUpId: 'm1', winningSide: 1, matchUpStatus: 'COMPLETED' } }),
      ).toBe(true);
    });

    it('returns false for mid-game IN_PROGRESS notice', () => {
      expect(
        isFinalizingNotice({ matchUp: { matchUpId: 'm1', matchUpStatus: 'IN_PROGRESS', winningSide: null } }),
      ).toBe(false);
    });

    it('returns false when neither winningSide nor COMPLETED is set', () => {
      expect(isFinalizingNotice({ matchUp: { matchUpId: 'm1', matchUpStatus: 'TO_BE_PLAYED' } })).toBe(false);
    });

    it('returns false when matchUpId is missing even if finalizing fields are set', () => {
      expect(isFinalizingNotice({ matchUp: { winningSide: 1 } })).toBe(false);
    });

    it('returns false when matchUp is undefined', () => {
      expect(isFinalizingNotice({})).toBe(false);
    });

    it('returns false when notice is null', () => {
      expect(isFinalizingNotice(null)).toBe(false);
    });

    it('returns false when notice is undefined', () => {
      expect(isFinalizingNotice(undefined)).toBe(false);
    });
  });

  describe('buildMatchUpFinalizedPayload', () => {
    it('produces a payload with matchUpId for a finalized matchUp', () => {
      const payload = buildMatchUpFinalizedPayload({
        matchUp: { matchUpId: 'mu-final-1', winningSide: 1 },
      });
      expect(payload).toEqual({ matchUpId: 'mu-final-1' });
    });

    it('produces a payload for matchUpStatus COMPLETED without winningSide', () => {
      const payload = buildMatchUpFinalizedPayload({
        matchUp: { matchUpId: 'mu-walkover-1', matchUpStatus: 'COMPLETED' },
      });
      expect(payload).toEqual({ matchUpId: 'mu-walkover-1' });
    });

    it('returns null for a non-finalizing notice', () => {
      expect(
        buildMatchUpFinalizedPayload({ matchUp: { matchUpId: 'm1', matchUpStatus: 'IN_PROGRESS' } }),
      ).toBeNull();
    });

    it('returns null when matchUp is missing', () => {
      expect(buildMatchUpFinalizedPayload({})).toBeNull();
    });
  });
});
