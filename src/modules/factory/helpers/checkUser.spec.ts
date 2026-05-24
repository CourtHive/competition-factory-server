import { checkUser } from './checkUser';

describe('checkUser', () => {
  it('returns true for SUPER_ADMIN', () => {
    expect(checkUser({ user: { roles: ['superadmin'] } })).toBe(true);
  });

  it('returns true for SUPER_ADMIN among other roles', () => {
    expect(checkUser({ user: { roles: ['client', 'superadmin', 'admin'] } })).toBe(true);
  });

  it('returns true for user with providerIds', () => {
    expect(checkUser({ user: { roles: ['client'], providerIds: ['p1'] } })).toBe(true);
  });

  it('returns true for user with providerId', () => {
    expect(checkUser({ user: { roles: ['client'], providerId: 'p1' } })).toBe(true);
  });

  it('returns false for user without roles or provider', () => {
    expect(checkUser({ user: { roles: ['client'] } })).toBe(false);
  });

  it('returns false for undefined user', () => {
    expect(checkUser({ user: undefined })).toBe(false);
  });

  it('returns false for null user', () => {
    expect(checkUser({ user: null })).toBe(false);
  });

  it('returns false for user with empty providerIds', () => {
    expect(checkUser({ user: { roles: ['client'], providerIds: [] } })).toBe(false);
  });

  // Multi-provider era: association lives in user_providers → userContext,
  // not on the legacy JWT providerId. Regression guard for the BOBOCA
  // DIRECTOR (empty users.provider_id) who got "Tournament not found".
  it('returns true for a multi-provider user via userContext.providerIds (empty legacy provider)', () => {
    expect(
      checkUser({ user: { roles: ['client', 'director'] }, userContext: { providerIds: ['boboca'] } as any }),
    ).toBe(true);
  });

  it('returns true for userContext.isSuperAdmin', () => {
    expect(checkUser({ user: { roles: ['client'] }, userContext: { isSuperAdmin: true } as any })).toBe(true);
  });

  it('returns true for a provisioner-inherited provider via userContext.provisionerProviderIds', () => {
    expect(
      checkUser({ user: { roles: ['client'] }, userContext: { provisionerProviderIds: ['p1'] } as any }),
    ).toBe(true);
  });

  it('returns false when userContext has no providers and legacy fields are empty', () => {
    expect(
      checkUser({ user: { roles: ['client'] }, userContext: { providerIds: [], provisionerProviderIds: [] } as any }),
    ).toBe(false);
  });
});
