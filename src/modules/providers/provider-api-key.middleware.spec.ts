import { ProviderApiKeyMiddleware, hashApiKey } from './provider-api-key.middleware';

function makeRes() {
  return {};
}

function makeNext() {
  return jest.fn();
}

describe('ProviderApiKeyMiddleware', () => {
  let apiKeyStorage: any;
  let mw: ProviderApiKeyMiddleware;

  beforeEach(() => {
    apiKeyStorage = {
      findByKeyHash: jest.fn(),
      updateLastUsed: jest.fn().mockResolvedValue(undefined),
    };
    mw = new ProviderApiKeyMiddleware(apiKeyStorage);
  });

  it('passes through when no Authorization header', async () => {
    const req: any = { headers: {} };
    const next = makeNext();
    await mw.use(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.provider).toBeUndefined();
    expect(apiKeyStorage.findByKeyHash).not.toHaveBeenCalled();
  });

  it('ignores Bearer tokens without the pkey_ prefix (lets provisioner middleware handle prov_ tokens)', async () => {
    const req: any = { headers: { authorization: 'Bearer prov_sk_live_abcdef' } };
    const next = makeNext();
    await mw.use(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.provider).toBeUndefined();
    expect(apiKeyStorage.findByKeyHash).not.toHaveBeenCalled();
  });

  it('ignores non-Bearer auth schemes', async () => {
    const req: any = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };
    const next = makeNext();
    await mw.use(req, makeRes(), next);
    expect(req.provider).toBeUndefined();
    expect(apiKeyStorage.findByKeyHash).not.toHaveBeenCalled();
  });

  it('attaches provider identity when the key matches', async () => {
    const rawKey = 'pkey_live_secret123';
    apiKeyStorage.findByKeyHash.mockResolvedValueOnce({
      key: {
        keyId: 'k-1',
        providerId: 'kronos',
        apiKeyHash: hashApiKey(rawKey),
        label: 'prod',
        isActive: true,
      },
      providerName: 'Kronos Sports',
      providerConfig: { permissions: { 'addEvent': true } },
    });
    const req: any = { headers: { authorization: `Bearer ${rawKey}` } };
    const next = makeNext();

    await mw.use(req, makeRes(), next);

    expect(apiKeyStorage.findByKeyHash).toHaveBeenCalledWith(hashApiKey(rawKey));
    expect(req.provider).toEqual({
      providerId: 'kronos',
      providerName: 'Kronos Sports',
      providerConfig: { permissions: { addEvent: true } },
      keyId: 'k-1',
      keyLabel: 'prod',
    });
    expect(req.auditSource).toEqual({
      type: 'provider-key',
      providerId: 'kronos',
      keyId: 'k-1',
      keyLabel: 'prod',
    });
    expect(req.user.providerId).toBe('kronos');
    expect(req.userContext.providerIds).toEqual(['kronos']);
    expect(req.userContext.providerRoles.kronos).toBe('PROVIDER_ADMIN');
    expect(req.userContext.isSuperAdmin).toBe(false);
    expect(apiKeyStorage.updateLastUsed).toHaveBeenCalledWith('k-1');
    expect(next).toHaveBeenCalled();
  });

  it('falls through (does not throw) when the key lookup returns null', async () => {
    apiKeyStorage.findByKeyHash.mockResolvedValueOnce(null);
    const req: any = { headers: { authorization: 'Bearer pkey_live_unknown' } };
    const next = makeNext();
    await mw.use(req, makeRes(), next);
    expect(req.provider).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('falls through when storage throws (degraded mode — AuthGuard will 401)', async () => {
    apiKeyStorage.findByKeyHash.mockRejectedValueOnce(new Error('PG down'));
    const req: any = { headers: { authorization: 'Bearer pkey_live_xyz' } };
    const next = makeNext();
    await mw.use(req, makeRes(), next);
    expect(req.provider).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});
