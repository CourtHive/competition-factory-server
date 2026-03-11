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
});
