import { resolveActingProviderId } from './actingProvider';

const base = { provisionerProviderIds: [] as string[], associatedIds: [] as string[], isSuperAdmin: false };

describe('resolveActingProviderId — the provider a session acts for', () => {
  it('a user with several providers and no choice acts for NONE (never silently placed in one)', () => {
    expect(resolveActingProviderId({ ...base, associatedIds: ['a', 'b'] })).toBeUndefined();
  });

  it('acts for the chosen provider when the user is associated with it', () => {
    expect(resolveActingProviderId({ ...base, associatedIds: ['a', 'b'], requested: 'b' })).toBe('b');
  });

  it('refuses a choice the user has no right to, rather than falling back to another provider', () => {
    expect(resolveActingProviderId({ ...base, associatedIds: ['a', 'b'], requested: 'c' })).toBeUndefined();
  });

  it('lets a provisioner act for a provider its provisioner manages, though it holds no association row', () => {
    expect(
      resolveActingProviderId({ ...base, associatedIds: ['a'], provisionerProviderIds: ['m'], requested: 'm' }),
    ).toBe('m');
  });

  it('a single association is the session provider, as before', () => {
    expect(resolveActingProviderId({ ...base, associatedIds: ['only'] })).toBe('only');
  });

  // users.provider_id, the legacy "home", is no longer read (multi-provider Phase 4): with no row there is no provider.
  it('no association rows acts for NONE', () => {
    expect(resolveActingProviderId(base)).toBeUndefined();
  });

  it('a super-admin may choose any provider, and acts for none when they choose none', () => {
    expect(resolveActingProviderId({ ...base, isSuperAdmin: true, requested: 'any' })).toBe('any');
    expect(resolveActingProviderId({ ...base, isSuperAdmin: true, associatedIds: ['a', 'b'] })).toBeUndefined();
    expect(resolveActingProviderId({ ...base, isSuperAdmin: true })).toBeUndefined();
  });
});
