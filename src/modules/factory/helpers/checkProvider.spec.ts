import { checkProvider } from './checkProvider';

describe('checkProvider', () => {
  it('returns true for SUPER_ADMIN regardless of records', () => {
    const result = checkProvider({
      tournamentRecords: {
        t1: { parentOrganisation: { organisationId: 'other-provider' } },
      },
      user: { roles: ['superadmin'] },
    });
    expect(result).toBe(true);
  });

  it('returns true when tournament belongs to user provider', () => {
    const result = checkProvider({
      tournamentRecords: {
        t1: { parentOrganisation: { organisationId: 'p1' } },
      },
      user: { roles: ['admin'], providerId: 'p1' },
    });
    expect(result).toBe(true);
  });

  it('returns false when tournament belongs to different provider', () => {
    const result = checkProvider({
      tournamentRecords: {
        t1: { parentOrganisation: { organisationId: 'p2' } },
      },
      user: { roles: ['admin'], providerId: 'p1' },
    });
    expect(result).toBe(false);
  });

  it('returns true with empty tournamentRecords', () => {
    const result = checkProvider({
      tournamentRecords: {},
      user: { roles: ['client'], providerId: 'p1' },
    });
    expect(result).toBe(true);
  });

  it('returns true with undefined tournamentRecords', () => {
    const result = checkProvider({
      tournamentRecords: undefined,
      user: { roles: ['client'] },
    });
    expect(result).toBe(true);
  });

  it('returns true when tournament has no parentOrganisation', () => {
    const result = checkProvider({
      tournamentRecords: {
        t1: {},
      },
      user: { roles: ['client'], providerId: 'p1' },
    });
    expect(result).toBe(true);
  });

  it('checks all tournaments — fails if any mismatch', () => {
    const result = checkProvider({
      tournamentRecords: {
        t1: { parentOrganisation: { organisationId: 'p1' } },
        t2: { parentOrganisation: { organisationId: 'p2' } },
      },
      user: { roles: ['admin'], providerId: 'p1' },
    });
    expect(result).toBe(false);
  });

  it('supports providerIds array — matches any provider in the array', () => {
    const result = checkProvider({
      tournamentRecords: {
        t1: { parentOrganisation: { organisationId: 'p1' } },
      },
      user: { roles: ['admin'], providerIds: ['p1', 'p2'] },
    });
    expect(result).toBe(true);
  });

  it('supports providerIds array — fails when provider not in array', () => {
    const result = checkProvider({
      tournamentRecords: {
        t1: { parentOrganisation: { organisationId: 'p3' } },
      },
      user: { roles: ['admin'], providerIds: ['p1', 'p2'] },
    });
    expect(result).toBe(false);
  });

  it('supports providerIds array — allows tournaments for different providers the user owns', () => {
    const result = checkProvider({
      tournamentRecords: {
        t1: { parentOrganisation: { organisationId: 'p1' } },
        t2: { parentOrganisation: { organisationId: 'p2' } },
      },
      user: { roles: ['admin'], providerIds: ['p1', 'p2'] },
    });
    expect(result).toBe(true);
  });

  it('returns false when user has no providerId or providerIds', () => {
    const result = checkProvider({
      tournamentRecords: {
        t1: { parentOrganisation: { organisationId: 'p1' } },
      },
      user: { roles: ['client'] },
    });
    expect(result).toBe(false);
  });

  describe('the session acts for one provider; a save needs a provider (CA, 2026-10-06)', () => {
    const userContext: any = {
      userId: 'u1',
      email: 'u1@x.org',
      isSuperAdmin: false,
      globalRoles: [],
      providerRoles: { a: 'PROVIDER_ADMIN', b: 'PROVIDER_ADMIN' },
      providerIds: ['a', 'b'],
      actingProviderId: 'a',
    };
    const records = (organisationId?: string) => ({
      t1: organisationId ? { parentOrganisation: { organisationId } } : {},
    });

    it('allows the provider the session acts for', () => {
      expect(checkProvider({ tournamentRecords: records('a'), userContext, write: true })).toBe(true);
    });

    it("refuses the user's OTHER provider, read or write: switch first", () => {
      expect(checkProvider({ tournamentRecords: records('b'), userContext })).toBe(false);
      expect(checkProvider({ tournamentRecords: records('b'), userContext, write: true })).toBe(false);
    });

    it('refuses to SAVE a tournament with no provider, and still lets one be read', () => {
      expect(checkProvider({ tournamentRecords: records(), userContext, write: true })).toBe(false);
      expect(checkProvider({ tournamentRecords: records(), userContext })).toBe(true);
    });

    it('lets a super-admin save a provider-less tournament', () => {
      expect(
        checkProvider({
          tournamentRecords: records(),
          userContext: { ...userContext, isSuperAdmin: true },
          write: true,
        }),
      ).toBe(true);
    });

    it('refuses everything to a session that has not chosen its provider', () => {
      const pending = { ...userContext, actingProviderId: undefined, providerSelectionPending: true };
      expect(checkProvider({ tournamentRecords: records('a'), userContext: pending })).toBe(false);
    });
  });
});
