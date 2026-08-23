import { isEvaluableScope, isTargetInScope, isTournamentWide, isWithinWindow, requiredTargetFields } from './grantScope';

describe('grantScope', () => {
  describe('empty scope is tournament-wide', () => {
    it('treats {} and undefined as unrestricted — the pre-existing behavior', () => {
      expect(isTournamentWide({})).toBe(true);
      expect(isTournamentWide(undefined)).toBe(true);
      expect(isTargetInScope({}, { matchUpId: 'm1' })).toBe(true);
      expect(isTargetInScope(undefined, {})).toBe(true);
    });
  });

  describe('the court case — a permission a global boolean cannot express', () => {
    const courtSeven = { courtIds: ['court-7'] };

    it('permits a matchUp on the granted court', () => {
      expect(isTargetInScope(courtSeven, { courtId: 'court-7' })).toBe(true);
    });

    it('refuses the final on Centre', () => {
      expect(isTargetInScope(courtSeven, { courtId: 'centre' })).toBe(false);
    });

    // An unscheduled matchUp is not on Court 7, so a Court-7 grant does not
    // cover it. Answering "unknown" with "allow" would be the fail-open shape.
    it('refuses a matchUp that cannot answer the dimension', () => {
      expect(isTargetInScope(courtSeven, { courtId: undefined })).toBe(false);
      expect(isTargetInScope(courtSeven, {})).toBe(false);
    });
  });

  describe('multiple dimensions', () => {
    it('requires every declared dimension to match', () => {
      const scope = { courtIds: ['c1'], scheduledDates: ['2026-08-24'] };
      expect(isTargetInScope(scope, { courtId: 'c1', scheduledDate: '2026-08-24' })).toBe(true);
      expect(isTargetInScope(scope, { courtId: 'c1', scheduledDate: '2026-08-25' })).toBe(false);
    });

    it('matches any value within a single dimension', () => {
      const scope = { courtIds: ['c1', 'c2'] };
      expect(isTargetInScope(scope, { courtId: 'c2' })).toBe(true);
      expect(isTargetInScope(scope, { courtId: 'c3' })).toBe(false);
    });

    it('ignores a dimension declared with an empty list', () => {
      expect(isTargetInScope({ courtIds: [] }, { courtId: undefined })).toBe(true);
    });
  });

  describe('unknown keys fail closed (A3)', () => {
    it('refuses a scope it cannot evaluate rather than waving it through', () => {
      const scope = { somethingNew: ['x'] } as any;
      expect(isEvaluableScope(scope)).toBe(false);
      expect(isTargetInScope(scope, { courtId: 'court-7' })).toBe(false);
    });

    it('accepts a scope built only from known keys', () => {
      expect(isEvaluableScope({ courtIds: ['c1'], matchUpIds: ['m1'] })).toBe(true);
    });
  });

  describe('time bounds — delivery roles are shift-based', () => {
    const now = new Date('2026-08-24T12:00:00Z');

    it('is live inside the window', () => {
      expect(isWithinWindow({ notBefore: '2026-08-24T08:00:00Z', notAfter: '2026-08-24T18:00:00Z' }, now)).toBe(true);
    });

    it('is not yet live before it starts', () => {
      expect(isWithinWindow({ notBefore: '2026-08-25T08:00:00Z' }, now)).toBe(false);
    });

    // The Saturday desk volunteer must not still hold the grant on Wednesday.
    it('has expired after it ends', () => {
      expect(isWithinWindow({ notAfter: '2026-08-23T18:00:00Z' }, now)).toBe(false);
    });

    it('is unbounded when no window is set', () => {
      expect(isWithinWindow({}, now)).toBe(true);
      expect(isWithinWindow({ notBefore: null, notAfter: null }, now)).toBe(true);
    });
  });

  describe('requiredTargetFields drives lazy resolution', () => {
    it('reports nothing for a tournament-wide grant, so no record walk is paid for', () => {
      expect(requiredTargetFields({})).toEqual([]);
      expect(requiredTargetFields(undefined)).toEqual([]);
    });

    it('reports only dimensions that actually constrain', () => {
      expect(requiredTargetFields({ courtIds: ['c1'], matchUpIds: [] })).toEqual(['courtId']);
    });
  });
});
