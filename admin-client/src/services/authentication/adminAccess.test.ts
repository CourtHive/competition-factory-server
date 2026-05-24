import { describe, expect, it } from 'vitest';
import { canAccessAdmin } from './adminAccess';

import type { LoginState } from 'types/tmx';

const base = (overrides: Partial<LoginState> = {}): LoginState =>
  ({ email: 'u@x.com', roles: [], permissions: [], services: [], exp: 0, ...overrides }) as LoginState;

describe('canAccessAdmin', () => {
  it('denies when no state', () => {
    expect(canAccessAdmin(undefined)).toBe(false);
  });

  it('denies a logged-in user with no admin role and no PROVIDER_ADMIN association', () => {
    expect(canAccessAdmin(base({ roles: ['client', 'score'] }))).toBe(false);
  });

  it('denies a DIRECTOR-only account', () => {
    const state = base({
      roles: ['client'],
      providerAssociations: [
        { providerId: 'p1', providerRole: 'DIRECTOR', organisationName: 'P1', organisationAbbreviation: 'P1' },
      ],
    });
    expect(canAccessAdmin(state)).toBe(false);
  });

  it('grants super-admin', () => {
    expect(canAccessAdmin(base({ roles: ['superadmin'] }))).toBe(true);
  });

  it('grants provisioner', () => {
    expect(canAccessAdmin(base({ roles: ['provisioner'] }))).toBe(true);
  });

  it('grants the deprecated global admin role (until retired)', () => {
    expect(canAccessAdmin(base({ roles: ['client', 'admin'] }))).toBe(true);
  });

  it('grants a PROVIDER_ADMIN association without any global admin role', () => {
    const state = base({
      roles: ['client'],
      providerAssociations: [
        { providerId: 'p1', providerRole: 'PROVIDER_ADMIN', organisationName: 'P1', organisationAbbreviation: 'P1' },
      ],
    });
    expect(canAccessAdmin(state)).toBe(true);
  });
});
