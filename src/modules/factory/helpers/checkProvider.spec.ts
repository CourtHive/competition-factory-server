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
});
