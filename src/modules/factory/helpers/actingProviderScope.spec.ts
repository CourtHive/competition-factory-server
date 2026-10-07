import { actingProviderAllows } from './actingProviderScope';

const ctx = (overrides: any = {}) => ({
  userId: 'u1',
  email: 'u1@x.org',
  isSuperAdmin: false,
  globalRoles: [],
  providerRoles: { a: 'PROVIDER_ADMIN', b: 'PROVIDER_ADMIN' },
  providerIds: ['a', 'b'],
  ...overrides,
});

describe('actingProviderAllows — a session touches only the provider it acts for (CA, 2026-10-06)', () => {
  it('a session that chose provider A may not touch provider B, though the user belongs to both', () => {
    expect(actingProviderAllows(ctx({ actingProviderId: 'a' }), 'a')).toBe(true);
    expect(actingProviderAllows(ctx({ actingProviderId: 'a' }), 'b')).toBe(false);
  });

  it('a session that has not chosen yet touches no provider', () => {
    expect(actingProviderAllows(ctx({ providerSelectionPending: true }), 'a')).toBe(false);
  });

  it('a super-admin touches any provider', () => {
    expect(actingProviderAllows(ctx({ isSuperAdmin: true, actingProviderId: 'a' }), 'b')).toBe(true);
  });

  it('a session with no provider claim (provisioner, pre-two-step token) is left to the membership gate', () => {
    expect(actingProviderAllows(ctx(), 'b')).toBe(true);
    expect(actingProviderAllows(undefined, 'b')).toBe(true);
  });
});
