import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';

import { PROVIDER_SELECTION_PURPOSE } from 'src/common/auth/actingProvider';
import { audienceMatches } from './guards/auth.guard';
import { resetSigningKeyCacheForTests } from 'src/common/auth/signJwt';
import { AuthService } from './auth.service';

/**
 * TWO-STEP LOGIN FOR A USER WITH MORE THAN ONE PROVIDER (CA, 2026-10-06).
 *
 * The CFS copy of courthive-hiveid's auth (the rollback target), held to the same behaviour.
 *
 * Login answers with the user's providers and a selection token; `select-provider` returns the session for
 * the chosen one. The selection token must be useless anywhere else, and a refreshed session must keep the
 * provider that was chosen.
 */

const PASSWORD = 'correct horse';
const PROVIDERS: Record<string, any> = {
  club: { organisationId: 'club', organisationName: 'Club', organisationAbbreviation: 'CLB' },
  league: { organisationId: 'league', organisationName: 'League', organisationAbbreviation: 'LGE' },
};

function make(options: { associations?: string[]; lastSelected?: string | null } = {}) {
  const associations = options.associations ?? ['club', 'league'];
  const user = {
    userId: 'u1',
    email: 'director@x.org',
    password: bcrypt.hashSync(PASSWORD, 4),
    roles: ['client'],
    providerId: 'club', // the legacy home column: it must NOT decide anything for a multi-provider user
    lastSelectedProviderId: options.lastSelected ?? null,
  };
  const userStorage: any = {
    findOne: vi.fn(async (email: string) => (email === user.email ? { ...user } : null)),
    findByUserId: vi.fn(async (id: string) => (id === user.userId ? { ...user } : null)),
    updateLastAccess: vi.fn().mockResolvedValue(undefined),
    updateLastSelectedProviderId: vi.fn().mockResolvedValue({ success: true }),
  };
  const userProviderStorage: any = {
    findByUserIdEnriched: vi.fn(async () =>
      associations.map((providerId) => ({
        providerId,
        providerRole: 'PROVIDER_ADMIN',
        organisationName: PROVIDERS[providerId]?.organisationName,
        organisationAbbreviation: PROVIDERS[providerId]?.organisationAbbreviation,
      })),
    ),
  };
  const providerStorage: any = {
    getProvider: vi.fn(async (id: string) => PROVIDERS[id] ?? null),
    updateLastAccess: vi.fn().mockResolvedValue(undefined),
  };
  let refreshRow: any;
  const refreshTokenService: any = {
    issue: vi.fn(async (_userId: string, _email: string, _ua?: string, acting?: string | null) => {
      refreshRow = { actingProviderId: acting ?? null };
      return 'rtok_issued';
    }),
    rotate: vi.fn(async () => ({
      userId: user.userId,
      email: user.email,
      refreshToken: 'rtok_next',
      actingProviderId: refreshRow?.actingProviderId ?? null,
    })),
  };
  const jwt = new JwtService({ secret: 'test-hs-secret' });
  // CFS reads users by email through UsersService and by id through USER_STORAGE
  const usersService: any = { findOne: userStorage.findOne };
  const service = new AuthService(
    usersService,
    jwt,
    {} as any,
    {} as any,
    providerStorage,
    userStorage,
    { findProvisionerIdsByUser: vi.fn().mockResolvedValue([]) } as any,
    userProviderStorage,
    { findByProvisioner: vi.fn().mockResolvedValue([]) } as any,
    refreshTokenService,
    {} as any,
    {} as any,
    {} as any,
  );
  return {
    service,
    jwt,
    user,
    userStorage,
    refreshTokenService,
    setAssociations: (ids: string[]) => associations.splice(0, associations.length, ...ids),
  };
}

describe('two-step login', () => {
  const savedEnv = { ...process.env };
  beforeAll(() => {
    delete process.env.JWT_SIGN_ES256;
    resetSigningKeyCacheForTests();
  });
  afterAll(() => {
    process.env = savedEnv;
    resetSigningKeyCacheForTests();
  });

  it('a user with several providers gets their providers and a selection token, NOT a session', async () => {
    const { service } = make({ lastSelected: 'league' });
    const result: any = await service.signIn('director@x.org', PASSWORD);
    expect(result.providerSelectionRequired).toBe(true);
    expect(result.token).toBeUndefined();
    expect(result.refreshToken).toBeUndefined();
    expect(result.providers.map((p: any) => p.providerId)).toEqual(['club', 'league']);
    // preselected in the picker (CA)
    expect(result.lastSelectedProviderId).toBe('league');
  });

  it('the selection token cannot pass for a user anywhere else', async () => {
    const { service, jwt } = make();
    const { selectionToken }: any = await service.signIn('director@x.org', PASSWORD);
    const claims: any = jwt.decode(selectionToken);
    expect(claims).toMatchObject({
      purpose: PROVIDER_SELECTION_PURPOSE,
      aud: 'provider-selection',
      selectingUserId: 'u1',
    });
    for (const claim of ['userId', 'sub', 'email', 'roles', 'providerId', 'providerIds'])
      expect(claims[claim]).toBeUndefined();
    // an admin route (the default audience) refuses it; only select-provider declares this audience
    expect(audienceMatches(claims.aud, ['admin'])).toBe(false);
    expect(audienceMatches(claims.aud, ['provider-selection', 'admin'])).toBe(true);
  });

  it('selecting a provider returns the session scoped to it, and remembers the choice', async () => {
    const { service, jwt, userStorage, refreshTokenService } = make();
    const { selectionToken }: any = await service.signIn('director@x.org', PASSWORD);
    const session: any = await service.selectProvider('league', jwt.decode(selectionToken));
    const claims: any = jwt.decode(session.token);
    expect(claims.providerId).toBe('league');
    expect(claims.provider.organisationId).toBe('league');
    expect(claims.providerSelectionRequired).toBe(false);
    expect(claims.aud).toBe('admin');
    expect(userStorage.updateLastSelectedProviderId).toHaveBeenCalledWith('director@x.org', 'league');
    // pinned to the refresh token
    expect(refreshTokenService.issue.mock.calls.at(-1)[3]).toBe('league');
  });

  it('refuses a provider the user is not associated with', async () => {
    const { service, jwt } = make();
    const { selectionToken }: any = await service.signIn('director@x.org', PASSWORD);
    await expect(service.selectProvider('elsewhere', jwt.decode(selectionToken))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses any other purpose token (first-login, password reset)', async () => {
    const { service } = make();
    await expect(
      service.selectProvider('club', { purpose: 'password-reset', email: 'director@x.org' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('switching with a full session token issues a session for the new provider', async () => {
    const { service, jwt } = make();
    const first: any = await service.selectProvider('club', { userId: 'u1' });
    const switched: any = await service.selectProvider('league', jwt.decode(first.token));
    expect((jwt.decode(switched.token) as any).providerId).toBe('league');
  });

  it('a refreshed session keeps the chosen provider; a removed association ends it', async () => {
    const { service, jwt, setAssociations } = make();
    await service.selectProvider('league', { userId: 'u1' });
    const refreshed: any = await service.refreshSession('rtok_issued');
    expect((jwt.decode(refreshed.token) as any).providerId).toBe('league');

    setAssociations(['club', 'other']);
    await expect(service.refreshSession('rtok_issued')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a single-provider user signs straight in, scoped to their provider, as before', async () => {
    const { service, jwt, refreshTokenService } = make({ associations: ['club'] });
    const result: any = await service.signIn('director@x.org', PASSWORD);
    expect(result.providerSelectionRequired).toBeUndefined();
    expect((jwt.decode(result.token) as any).providerId).toBe('club');
    // nothing pinned: their session rebuilds exactly as before on refresh
    expect(refreshTokenService.issue.mock.calls.at(-1)[3]).toBeUndefined();
  });
});
