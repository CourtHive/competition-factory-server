import { ProvisionerMiddleware, hashApiKey } from './provisioner.middleware';

function makeMockApiKeyStorage(result: any = null) {
  return {
    findByKeyHash: jest.fn().mockResolvedValue(result),
    updateLastUsed: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMockProviderStorage(relationship: 'owner' | 'subsidiary' | null = null) {
  return {
    getRelationship: jest.fn().mockResolvedValue(relationship),
  };
}

function makeMockProvisionerStorage() {
  return {
    getProvisioner: jest.fn().mockResolvedValue(null),
  };
}

function makeMockJwtService(verifyResult: any = null) {
  return {
    verifyAsync: verifyResult instanceof Error
      ? jest.fn().mockRejectedValue(verifyResult)
      : jest.fn().mockResolvedValue(verifyResult),
  };
}

function makeMiddleware(
  apiKeyStorage: any = makeMockApiKeyStorage(),
  providerStorage: any = makeMockProviderStorage(),
  provisionerStorage: any = makeMockProvisionerStorage(),
  jwtService: any = makeMockJwtService(new Error('not jwt')),
) {
  return new ProvisionerMiddleware(apiKeyStorage, providerStorage, provisionerStorage, jwtService);
}

function makeReq(authorization?: string, headers?: Record<string, string>) {
  return {
    headers: { authorization, ...headers },
    baseUrl: '/test',
  } as any;
}

const VALID_KEY_RESULT = {
  key: {
    keyId: 'key-1',
    provisionerId: 'prov-1',
    apiKeyHash: 'hash',
    label: 'prod',
    isActive: true,
  },
  provisionerName: 'IONSport',
  provisionerConfig: { foo: 1 },
};

describe('ProvisionerMiddleware', () => {
  it('passes through when no authorization header', async () => {
    const middleware = makeMiddleware(makeMockApiKeyStorage(), makeMockProviderStorage());
    const req = makeReq();
    const next = jest.fn();
    await middleware.use(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.provisioner).toBeUndefined();
  });

  it('passes through for non-provisioner Bearer tokens (JWT)', async () => {
    const middleware = makeMiddleware(makeMockApiKeyStorage(), makeMockProviderStorage());
    const req = makeReq('Bearer eyJhbGciOiJIUzI1NiJ9.test');
    const next = jest.fn();
    await middleware.use(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.provisioner).toBeUndefined();
  });

  it('passes through when API key not found', async () => {
    const middleware = makeMiddleware(makeMockApiKeyStorage(null), makeMockProviderStorage());
    const req = makeReq('Bearer prov_sk_live_testkey');
    const next = jest.fn();
    await middleware.use(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.provisioner).toBeUndefined();
  });

  it('sets request.provisioner for valid API key', async () => {
    const apiKeyStorage = makeMockApiKeyStorage(VALID_KEY_RESULT);
    const middleware = makeMiddleware(apiKeyStorage, makeMockProviderStorage());
    const req = makeReq('Bearer prov_sk_live_testkey');
    const next = jest.fn();
    await middleware.use(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(req.provisioner).toEqual({
      provisionerId: 'prov-1',
      name: 'IONSport',
      config: { foo: 1 },
      keyId: 'key-1',
      keyLabel: 'prod',
    });
    expect(req.auditSource).toEqual({
      type: 'provisioner',
      provisionerId: 'prov-1',
      keyId: 'key-1',
      keyLabel: 'prod',
    });
  });

  it('fires updateLastUsed without blocking', async () => {
    const apiKeyStorage = makeMockApiKeyStorage(VALID_KEY_RESULT);
    const middleware = makeMiddleware(apiKeyStorage, makeMockProviderStorage());
    const req = makeReq('Bearer prov_sk_live_testkey');
    await middleware.use(req, {}, jest.fn());
    expect(apiKeyStorage.updateLastUsed).toHaveBeenCalledWith('key-1');
  });

  it('sets synthetic user context with X-Provider-Id for owner', async () => {
    const apiKeyStorage = makeMockApiKeyStorage(VALID_KEY_RESULT);
    const providerStorage = makeMockProviderStorage('owner');
    const middleware = makeMiddleware(apiKeyStorage, providerStorage);
    const req = makeReq('Bearer prov_sk_live_testkey', { 'x-provider-id': 'provider-abc' });
    await middleware.use(req, {}, jest.fn());

    expect(req.provisionerRelationship).toBe('owner');
    expect(req.user.roles).toContain('client');
    expect(req.userContext.providerRoles).toEqual({ 'provider-abc': 'PROVIDER_ADMIN' });
    expect(req.userContext.providerIds).toEqual(['provider-abc']);
  });

  it('sets synthetic user context with X-Provider-Id for subsidiary', async () => {
    const apiKeyStorage = makeMockApiKeyStorage(VALID_KEY_RESULT);
    const providerStorage = makeMockProviderStorage('subsidiary');
    const middleware = makeMiddleware(apiKeyStorage, providerStorage);
    const req = makeReq('Bearer prov_sk_live_testkey', { 'x-provider-id': 'provider-abc' });
    await middleware.use(req, {}, jest.fn());

    expect(req.provisionerRelationship).toBe('subsidiary');
    expect(req.userContext).toBeDefined();
  });

  it('does not set user context when X-Provider-Id not managed', async () => {
    const apiKeyStorage = makeMockApiKeyStorage(VALID_KEY_RESULT);
    const providerStorage = makeMockProviderStorage(null);
    const middleware = makeMiddleware(apiKeyStorage, providerStorage);
    const req = makeReq('Bearer prov_sk_live_testkey', { 'x-provider-id': 'unmanaged' });
    await middleware.use(req, {}, jest.fn());

    expect(req.provisioner).toBeDefined();
    expect(req.provisionerRelationship).toBeUndefined();
    expect(req.user).toBeUndefined();
  });

  it('handles apiKeyStorage errors gracefully', async () => {
    const apiKeyStorage = { findByKeyHash: jest.fn().mockRejectedValue(new Error('db down')), updateLastUsed: jest.fn() };
    const middleware = makeMiddleware(apiKeyStorage, makeMockProviderStorage());
    const req = makeReq('Bearer prov_sk_live_testkey');
    const next = jest.fn();
    await middleware.use(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.provisioner).toBeUndefined();
  });
});

describe('ProvisionerMiddleware JWT path (Phase 2A)', () => {
  it('attaches provisioner from JWT when user has PROVISIONER role + provisionerIds', async () => {
    const provisionerStorage = {
      getProvisioner: jest.fn().mockResolvedValue({
        provisionerId: 'prov-1',
        name: 'IONSport',
        config: { foo: 1 },
        isActive: true,
      }),
    };
    const jwtService = makeMockJwtService({
      userId: 'user-1',
      email: 'nikola@ionsport.test',
      roles: ['provisioner'],
      provisionerIds: ['prov-1'],
    });
    const middleware = makeMiddleware(
      makeMockApiKeyStorage(),
      makeMockProviderStorage(),
      provisionerStorage,
      jwtService,
    );
    const req = makeReq('Bearer eyJhbGciOiJIUzI1NiJ9.user-jwt');
    await middleware.use(req, {}, jest.fn());

    expect(req.provisioner).toMatchObject({
      provisionerId: 'prov-1',
      name: 'IONSport',
      authMode: 'jwt',
    });
    expect(req.auditSource).toMatchObject({
      type: 'provisioner-jwt',
      provisionerId: 'prov-1',
      userId: 'user-1',
      userEmail: 'nikola@ionsport.test',
    });
  });

  it('does not attach when JWT user lacks PROVISIONER role', async () => {
    const provisionerStorage = { getProvisioner: jest.fn() };
    const jwtService = makeMockJwtService({
      userId: 'user-2',
      roles: ['client'],
      provisionerIds: ['prov-1'],
    });
    const middleware = makeMiddleware(
      makeMockApiKeyStorage(),
      makeMockProviderStorage(),
      provisionerStorage,
      jwtService,
    );
    const req = makeReq('Bearer eyJhbGciOiJIUzI1NiJ9.user-jwt');
    await middleware.use(req, {}, jest.fn());

    expect(req.provisioner).toBeUndefined();
    expect(provisionerStorage.getProvisioner).not.toHaveBeenCalled();
  });

  it('honours X-Provisioner-Id header when user represents multiple', async () => {
    const provisionerStorage = {
      getProvisioner: jest.fn().mockResolvedValue({
        provisionerId: 'prov-2',
        name: 'OtherProv',
        config: {},
        isActive: true,
      }),
    };
    const jwtService = makeMockJwtService({
      userId: 'u',
      roles: ['provisioner'],
      provisionerIds: ['prov-1', 'prov-2'],
    });
    const middleware = makeMiddleware(
      makeMockApiKeyStorage(),
      makeMockProviderStorage(),
      provisionerStorage,
      jwtService,
    );
    const req = makeReq('Bearer eyJhbGciOiJIUzI1NiJ9.user-jwt', { 'x-provisioner-id': 'prov-2' });
    await middleware.use(req, {}, jest.fn());

    expect(provisionerStorage.getProvisioner).toHaveBeenCalledWith('prov-2');
    expect(req.provisioner.provisionerId).toBe('prov-2');
  });

  it('does not attach for inactive provisioner', async () => {
    const provisionerStorage = {
      getProvisioner: jest.fn().mockResolvedValue({
        provisionerId: 'prov-1',
        name: 'X',
        config: {},
        isActive: false,
      }),
    };
    const jwtService = makeMockJwtService({
      userId: 'u',
      roles: ['provisioner'],
      provisionerIds: ['prov-1'],
    });
    const middleware = makeMiddleware(
      makeMockApiKeyStorage(),
      makeMockProviderStorage(),
      provisionerStorage,
      jwtService,
    );
    const req = makeReq('Bearer eyJhbGciOiJIUzI1NiJ9.user-jwt');
    await middleware.use(req, {}, jest.fn());

    expect(req.provisioner).toBeUndefined();
  });
});

describe('hashApiKey', () => {
  it('produces consistent SHA-256 hex digest', () => {
    const hash1 = hashApiKey('prov_sk_live_abc123');
    const hash2 = hashApiKey('prov_sk_live_abc123');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it('produces different hashes for different keys', () => {
    const hash1 = hashApiKey('prov_sk_live_key1');
    const hash2 = hashApiKey('prov_sk_live_key2');
    expect(hash1).not.toBe(hash2);
  });
});
