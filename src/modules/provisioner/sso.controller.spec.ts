import { SplitTokenSigner } from 'src/services/split-token-signer.service';
import { SsoController } from './sso.controller';

function makeMockSsoTokenService() {
  return {
    generate: vi.fn(),
    consume: vi.fn(),
  };
}

function makeMockJwtService() {
  return {
    signAsync: vi.fn().mockResolvedValue('mock-jwt-token'),
  };
}

function makeMockSsoIdentityStorage() {
  return {
    findByExternalId: vi.fn(),
    findByUserId: vi.fn().mockResolvedValue([]),
  };
}

function makeMockUserStorage() {
  return {
    findOne: vi.fn(),
    updateLastAccess: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockUserProviderStorage() {
  return {
    findByUserId: vi.fn().mockResolvedValue([{ email: 'test@test.com', userId: 'u1', providerId: 'p1', providerRole: 'DIRECTOR' }]),
    findByEmail: vi.fn().mockResolvedValue([]),
    findByProviderId: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn(),
  };
}

function makeMockProviderStorage() {
  return {
    getProvider: vi.fn().mockResolvedValue({ organisationName: 'Test Org', organisationAbbreviation: 'TST' }),
    getProviders: vi.fn().mockResolvedValue([]),
    setProvider: vi.fn().mockResolvedValue({ success: true }),
    removeProvider: vi.fn().mockResolvedValue({ success: true }),
    updateLastAccess: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SsoController', () => {
  let controller: SsoController;
  let ssoTokenService: ReturnType<typeof makeMockSsoTokenService>;
  let ssoIdentityStorage: ReturnType<typeof makeMockSsoIdentityStorage>;
  let userStorage: ReturnType<typeof makeMockUserStorage>;
  let userProviderStorage: ReturnType<typeof makeMockUserProviderStorage>;
  let providerStorage: ReturnType<typeof makeMockProviderStorage>;
  let jwtService: ReturnType<typeof makeMockJwtService>;

  beforeEach(() => {
    ssoTokenService = makeMockSsoTokenService();
    jwtService = makeMockJwtService();
    ssoIdentityStorage = makeMockSsoIdentityStorage();
    userStorage = makeMockUserStorage();
    userProviderStorage = makeMockUserProviderStorage();
    providerStorage = makeMockProviderStorage();

    const userProvisionerStorage: any = { findProvisionerIdsByUser: vi.fn().mockResolvedValue([]) };
    const provisionerProviderStorage: any = { findByProvisioner: vi.fn().mockResolvedValue([]) };
    const refreshTokenService: any = { issue: vi.fn().mockResolvedValue('rtok_sso') };

    // HIVEID_BASE_URL unset → SplitTokenSigner signs locally via the mock
    // jwtService (returns 'mock-jwt-token'), so accessToken assertions are unchanged.
    controller = new SsoController(
      ssoTokenService as any,
      jwtService as any,
      refreshTokenService,
      new SplitTokenSigner(),
      ssoIdentityStorage as any,
      userStorage as any,
      userProviderStorage as any,
      userProvisionerStorage,
      provisionerProviderStorage,
      providerStorage as any,
    );
  });

  describe('generate', () => {
    it('returns token when identity exists', async () => {
      ssoIdentityStorage.findByExternalId.mockResolvedValueOnce({ userId: 'u1', ssoProvider: 'ioncourt', externalId: 'ext-1' });
      ssoTokenService.generate.mockResolvedValueOnce({ token: 'tok-uuid', expiresIn: 60 });

      let result: any = await controller.generate(
        { provisioner: { provisionerId: 'prov-1' } },
        { externalId: 'ext-1', ssoProvider: 'ioncourt', providerId: 'p1' },
      );

      expect(result.token).toBe('tok-uuid');
      expect(result.expiresIn).toBe(60);
      expect(ssoTokenService.generate).toHaveBeenCalledWith({
        externalId: 'ext-1',
        ssoProvider: 'ioncourt',
        providerId: 'p1',
        provisionerId: 'prov-1',
      });
    });

    it('returns error when identity not found', async () => {
      ssoIdentityStorage.findByExternalId.mockResolvedValueOnce(null);

      let result: any = await controller.generate(
        { provisioner: { provisionerId: 'prov-1' } },
        { externalId: 'missing', ssoProvider: 'ioncourt', providerId: 'p1' },
      );

      expect(result.error).toContain('SSO identity not found');
    });

    it('returns error when required fields missing', async () => {
      let result: any = await controller.generate(
        { provisioner: { provisionerId: 'prov-1' } },
        { externalId: '', ssoProvider: 'ioncourt', providerId: 'p1' },
      );

      expect(result.error).toContain('required');
    });
  });

  describe('loginWithToken', () => {
    it('exchanges token for JWT', async () => {
      ssoTokenService.consume.mockResolvedValueOnce({
        externalId: 'ext-1', ssoProvider: 'ioncourt', providerId: 'p1', provisionerId: 'prov-1',
      });
      ssoIdentityStorage.findByExternalId.mockResolvedValueOnce({ userId: 'u1', ssoProvider: 'ioncourt', externalId: 'ext-1' });
      userStorage.findOne.mockResolvedValueOnce({ email: 'test@test.com', userId: 'u1', roles: ['client'], password: '' });

      let result: any = await controller.loginWithToken({ token: 'tok-uuid' });

      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.user.userId).toBe('u1');
      expect(result.user.email).toBe('test@test.com');
    });

    it('updates lastAccess for both user and resolved provider', async () => {
      ssoTokenService.consume.mockResolvedValueOnce({
        externalId: 'ext-1', ssoProvider: 'ioncourt', providerId: 'p-resolved', provisionerId: 'prov-1',
      });
      ssoIdentityStorage.findByExternalId.mockResolvedValueOnce({ userId: 'u1', ssoProvider: 'ioncourt', externalId: 'ext-1' });
      userStorage.findOne.mockResolvedValueOnce({ email: 'sso@test.com', userId: 'u1', roles: ['client'], password: '' });

      await controller.loginWithToken({ token: 'tok-uuid' });

      // Promise.resolve flush so the fire-and-forget .catch handlers settle
      await Promise.resolve();
      expect(userStorage.updateLastAccess).toHaveBeenCalledWith('sso@test.com');
      expect(providerStorage.updateLastAccess).toHaveBeenCalledWith('p-resolved');
    });

    it('returns error for expired/consumed token', async () => {
      ssoTokenService.consume.mockResolvedValueOnce(null);

      let result: any = await controller.loginWithToken({ token: 'expired' });
      expect(result.error).toContain('expired or not found');
    });

    it('returns error when SSO identity missing', async () => {
      ssoTokenService.consume.mockResolvedValueOnce({
        externalId: 'ext-gone', ssoProvider: 'ioncourt', providerId: 'p1', provisionerId: 'prov-1',
      });
      ssoIdentityStorage.findByExternalId.mockResolvedValueOnce(null);

      let result: any = await controller.loginWithToken({ token: 'tok-uuid' });
      expect(result.error).toContain('User not found for SSO identity');
    });

    it('returns error when token is missing', async () => {
      let result: any = await controller.loginWithToken({ token: '' });
      expect(result.error).toContain('Token is required');
    });
  });
});
