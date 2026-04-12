import {
  canAccessOfficialRecord,
  canEvaluateOfficial,
  canManageOfficials,
  getOfficiatingScopeProviderId,
  EVALUATOR_METHODS,
  MANAGER_METHODS,
  QUERY_METHODS,
} from './checkOfficiatingAccess';

describe('checkOfficiatingAccess', () => {
  const superAdmin = { roles: ['superadmin'], providerId: 'provider-1' };
  const admin = { roles: ['admin'], providerId: 'provider-1' };
  const client = { roles: ['client'], providerId: 'provider-1' };
  const otherClient = { roles: ['client'], providerId: 'provider-2' };
  const noProvider = { roles: ['client'] };

  const record = { officialRecordId: 'rec-1', providerId: 'provider-1' };

  describe('canAccessOfficialRecord', () => {
    it('returns false with no user', () => {
      expect(canAccessOfficialRecord({ officialRecord: record, user: null })).toBe(false);
    });

    it('grants SUPER_ADMIN access to any record', () => {
      expect(canAccessOfficialRecord({ officialRecord: record, user: superAdmin })).toBe(true);
    });

    it('grants ADMIN access to own provider records', () => {
      expect(canAccessOfficialRecord({ officialRecord: record, user: admin })).toBe(true);
    });

    it('grants CLIENT access to own provider records', () => {
      expect(canAccessOfficialRecord({ officialRecord: record, user: client })).toBe(true);
    });

    it('denies CLIENT access to other provider records', () => {
      expect(canAccessOfficialRecord({ officialRecord: record, user: otherClient })).toBe(false);
    });

    it('handles user with providerIds array', () => {
      const multiProvider = { roles: ['client'], providerIds: ['provider-1', 'provider-3'] };
      expect(canAccessOfficialRecord({ officialRecord: record, user: multiProvider })).toBe(true);
    });

    it('denies access when record has no providerId', () => {
      const noProviderRecord = { officialRecordId: 'rec-2' };
      expect(canAccessOfficialRecord({ officialRecord: noProviderRecord, user: client })).toBe(false);
    });
  });

  describe('canEvaluateOfficial', () => {
    it('returns false with no user', () => {
      expect(canEvaluateOfficial({ user: null })).toBe(false);
    });

    it('allows SUPER_ADMIN', () => {
      expect(canEvaluateOfficial({ user: superAdmin })).toBe(true);
    });

    it('allows ADMIN', () => {
      expect(canEvaluateOfficial({ user: admin })).toBe(true);
    });

    it('denies CLIENT', () => {
      expect(canEvaluateOfficial({ user: client })).toBe(false);
    });
  });

  describe('canManageOfficials', () => {
    it('returns false with no user', () => {
      expect(canManageOfficials({ user: null })).toBe(false);
    });

    it('allows user with provider context', () => {
      expect(canManageOfficials({ user: client })).toBe(true);
    });

    it('allows SUPER_ADMIN without provider', () => {
      const superNoProvider = { roles: ['superadmin'] };
      expect(canManageOfficials({ user: superNoProvider })).toBe(true);
    });

    it('denies user without provider or superadmin', () => {
      expect(canManageOfficials({ user: noProvider })).toBe(false);
    });
  });

  describe('getOfficiatingScopeProviderId', () => {
    it('returns undefined for SUPER_ADMIN (sees all)', () => {
      expect(getOfficiatingScopeProviderId({ user: superAdmin })).toBeUndefined();
    });

    it('returns providerId for regular user', () => {
      expect(getOfficiatingScopeProviderId({ user: client })).toBe('provider-1');
    });

    it('returns undefined for no user', () => {
      expect(getOfficiatingScopeProviderId({ user: null })).toBeUndefined();
    });
  });

  describe('method lists', () => {
    it('has no overlap between evaluator, manager, and query methods', () => {
      const all = [...EVALUATOR_METHODS, ...MANAGER_METHODS, ...QUERY_METHODS];
      const unique = new Set(all);
      expect(unique.size).toBe(all.length);
    });

    it('categorizes evaluation mutations as evaluator methods', () => {
      expect(EVALUATOR_METHODS).toContain('addEvaluation');
      expect(EVALUATOR_METHODS).toContain('transitionEvaluationStatus');
    });

    it('categorizes certification mutations as manager methods', () => {
      expect(MANAGER_METHODS).toContain('addCertification');
      expect(MANAGER_METHODS).toContain('transitionCertificationStatus');
    });

    it('categorizes reads as query methods', () => {
      expect(QUERY_METHODS).toContain('getOfficialRecord');
      expect(QUERY_METHODS).toContain('getEvaluationSummary');
    });
  });
});
