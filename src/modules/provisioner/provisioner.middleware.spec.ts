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

  // Asymmetric 403 fix (MED, 2026-05-31 punch list): the JWT path must
  // synthesize req.user + req.userContext just like the API-key path
  // when X-Provider-Id is present and the relationship resolves. Without
  // this, /auth/tracker-token's canMutateTournament gate sees undefined
  // userContext and 403s, while the API-key path succeeds for the same
  // impersonation.
  it('synthesizes req.user + req.userContext when X-Provider-Id resolves to a relationship', async () => {
    const provisionerStorage = {
      getProvisioner: jest.fn().mockResolvedValue({
        provisionerId: 'prov-1',
        name: 'IONSport',
        config: {},
        isActive: true,
      }),
    };
    const providerStorage = makeMockProviderStorage('owner');
    const jwtService = makeMockJwtService({
      userId: 'u-nikola',
      email: 'nikola@ionsport.test',
      roles: ['provisioner'],
      provisionerIds: ['prov-1'],
    });
    const middleware = makeMiddleware(
      makeMockApiKeyStorage(),
      providerStorage,
      provisionerStorage,
      jwtService,
    );
    const req = makeReq('Bearer eyJhbGciOiJIUzI1NiJ9.user-jwt', { 'x-provider-id': 'provider-abc' });
    await middleware.use(req, {}, jest.fn());

    expect(req.provisionerRelationship).toBe('owner');
    // Mirror exactly the API-key path's synthetic identity shape so
    // downstream auth gates have no way to distinguish the two paths.
    expect(req.user).toEqual({
      userId: 'provisioner:prov-1',
      email: 'provisioner@IONSport',
      roles: ['client', 'generate', 'score'],
      providerId: 'provider-abc',
    });
    expect(req.userContext).toEqual({
      userId: 'provisioner:prov-1',
      email: 'provisioner@IONSport',
      isSuperAdmin: false,
      globalRoles: ['client', 'generate', 'score'],
      providerRoles: { 'provider-abc': 'PROVIDER_ADMIN' },
      providerIds: ['provider-abc'],
      provisionerProviderIds: [],
    });
  });

  it('does not set req.user / req.userContext when X-Provider-Id is missing on the JWT path', async () => {
    const provisionerStorage = {
      getProvisioner: jest.fn().mockResolvedValue({
        provisionerId: 'prov-1',
        name: 'IONSport',
        config: {},
        isActive: true,
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

    expect(req.provisioner).toBeDefined();
    expect(req.user).toBeUndefined();
    expect(req.userContext).toBeUndefined();
  });

  // Code-review fix #1 (2026-06-01): when AuthMiddleware has already
  // populated req.user with the real authenticated user (e.g. a
  // super-admin who also happens to administer this provisioner), the
  // JWT path must NOT clobber that identity. It merges the impersonation
  // context instead — preserving SUPER_ADMIN roles, real userId/email,
  // and other providerRoles entries.
  it('merges X-Provider-Id into an existing AuthMiddleware-populated identity without downgrading', async () => {
    const provisionerStorage = {
      getProvisioner: jest.fn().mockResolvedValue({
        provisionerId: 'prov-1',
        name: 'IONSport',
        config: {},
        isActive: true,
      }),
    };
    const providerStorage = makeMockProviderStorage('owner');
    const jwtService = makeMockJwtService({
      userId: 'u-admin',
      email: 'admin@courthive.test',
      roles: ['provisioner', 'superadmin'],
      provisionerIds: ['prov-1'],
    });
    const middleware = makeMiddleware(
      makeMockApiKeyStorage(),
      providerStorage,
      provisionerStorage,
      jwtService,
    );
    const req = makeReq('Bearer eyJhbGciOiJIUzI1NiJ9.user-jwt', { 'x-provider-id': 'provider-abc' });
    // AuthMiddleware already ran upstream and populated req.user / req.userContext.
    req.user = {
      userId: 'u-admin',
      email: 'admin@courthive.test',
      roles: ['client', 'generate', 'score', 'superadmin'],
    };
    req.userContext = {
      userId: 'u-admin',
      email: 'admin@courthive.test',
      isSuperAdmin: true,
      globalRoles: ['client', 'generate', 'score', 'superadmin'],
      providerRoles: { 'other-provider': 'DIRECTOR' },
      providerIds: ['other-provider'],
      provisionerProviderIds: [],
    };
    await middleware.use(req, {}, jest.fn());

    expect(req.provisionerRelationship).toBe('owner');
    // Real identity preserved — userId/email/roles untouched, providerId attached.
    expect(req.user.userId).toBe('u-admin');
    expect(req.user.email).toBe('admin@courthive.test');
    expect(req.user.roles).toContain('superadmin');
    expect(req.user.providerId).toBe('provider-abc');
    // userContext keeps SUPER_ADMIN and the prior provider, gains the new providerId.
    expect(req.userContext.isSuperAdmin).toBe(true);
    expect(req.userContext.globalRoles).toContain('superadmin');
    expect(req.userContext.providerRoles).toEqual({
      'other-provider': 'DIRECTOR',
      'provider-abc': 'PROVIDER_ADMIN',
    });
    expect(req.userContext.providerIds.sort()).toEqual(['other-provider', 'provider-abc']);
  });

  it('does not downgrade an existing direct provider role when merging', async () => {
    const provisionerStorage = {
      getProvisioner: jest.fn().mockResolvedValue({
        provisionerId: 'prov-1',
        name: 'IONSport',
        config: {},
        isActive: true,
      }),
    };
    const providerStorage = makeMockProviderStorage('owner');
    const jwtService = makeMockJwtService({
      userId: 'u',
      roles: ['provisioner'],
      provisionerIds: ['prov-1'],
    });
    const middleware = makeMiddleware(
      makeMockApiKeyStorage(),
      providerStorage,
      provisionerStorage,
      jwtService,
    );
    const req = makeReq('Bearer eyJhbGciOiJIUzI1NiJ9.user-jwt', { 'x-provider-id': 'provider-abc' });
    req.user = { userId: 'u', email: 'u@x', roles: ['client'] };
    req.userContext = {
      userId: 'u',
      email: 'u@x',
      isSuperAdmin: false,
      globalRoles: ['client'],
      // User already has DIRECTOR on provider-abc directly; merging
      // PROVIDER_ADMIN would be an upgrade, but the merge logic keeps
      // the existing direct role intact.
      providerRoles: { 'provider-abc': 'DIRECTOR' },
      providerIds: ['provider-abc'],
      provisionerProviderIds: [],
    };
    await middleware.use(req, {}, jest.fn());

    expect(req.userContext.providerRoles['provider-abc']).toBe('DIRECTOR');
  });

  it('does not set req.user / req.userContext when X-Provider-Id is not in the provisioner relationship', async () => {
    const provisionerStorage = {
      getProvisioner: jest.fn().mockResolvedValue({
        provisionerId: 'prov-1',
        name: 'IONSport',
        config: {},
        isActive: true,
      }),
    };
    const providerStorage = makeMockProviderStorage(null); // unmanaged
    const jwtService = makeMockJwtService({
      userId: 'u',
      roles: ['provisioner'],
      provisionerIds: ['prov-1'],
    });
    const middleware = makeMiddleware(
      makeMockApiKeyStorage(),
      providerStorage,
      provisionerStorage,
      jwtService,
    );
    const req = makeReq('Bearer eyJhbGciOiJIUzI1NiJ9.user-jwt', { 'x-provider-id': 'unmanaged' });
    await middleware.use(req, {}, jest.fn());

    expect(req.provisioner).toBeDefined();
    expect(req.provisionerRelationship).toBeUndefined();
    expect(req.user).toBeUndefined();
    expect(req.userContext).toBeUndefined();
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
