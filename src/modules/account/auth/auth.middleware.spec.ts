import { AuthMiddleware } from './auth.middleware';
import type { Mock } from 'vitest';

// The middleware verifies tokens via the neutral verifyJwt (no longer the MOVE
// AuthService.decode), so we mock the function. verifyJwtMock stands in for the
// former AuthService.decode — same behavioral assertions.
vi.mock('src/common/auth/verifyJwt', () => ({ verifyJwt: vi.fn() }));
import { verifyJwt } from 'src/common/auth/verifyJwt';
const verifyJwtMock = verifyJwt as Mock;

describe('AuthMiddleware', () => {
  let middleware: AuthMiddleware;
  let mockUsersService: any;
  let mockUserProviderStorage: any;

  beforeEach(() => {
    verifyJwtMock.mockReset();
    mockUsersService = {
      findOne: vi.fn(),
    };
    mockUserProviderStorage = {
      findByUserId: vi.fn().mockResolvedValue([]),
    };
    const mockUserProvisionerStorage: any = { findProvisionerIdsByUser: vi.fn().mockResolvedValue([]) };
    const mockProvisionerProviderStorage: any = { findByProvisioner: vi.fn().mockResolvedValue([]) };
    middleware = new AuthMiddleware(
      {} as any, // JwtService — unused; verifyJwt is mocked
      mockUsersService,
      mockUserProviderStorage,
      mockUserProvisionerStorage,
      mockProvisionerProviderStorage,
    );
  });

  it('calls next immediately for empty baseUrl', async () => {
    const req: any = { baseUrl: '', headers: {} };
    const next = vi.fn();
    await middleware.use(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(verifyJwtMock).not.toHaveBeenCalled();
  });

  it('calls next without setting user when no authorization header', async () => {
    const req: any = { baseUrl: '/api', headers: {} };
    const next = vi.fn();
    await middleware.use(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('decodes token and sets user and userContext on request', async () => {
    const user = { email: 'test@test.com', userId: 'uuid-1', roles: ['admin'], providerId: 'prov-1' };
    verifyJwtMock.mockResolvedValue({ email: 'test@test.com' });
    mockUsersService.findOne.mockResolvedValue(user);
    mockUserProviderStorage.findByUserId.mockResolvedValue([
      { userId: 'uuid-1', providerId: 'prov-1', providerRole: 'PROVIDER_ADMIN' },
    ]);

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer valid.token' } };
    const next = vi.fn();
    await middleware.use(req, {}, next);

    expect(verifyJwtMock).toHaveBeenCalledWith(expect.anything(), 'valid.token');
    expect(mockUsersService.findOne).toHaveBeenCalledWith('test@test.com');
    expect(req.user).toBe(user);
    expect(req.userContext).toBeDefined();
    expect(req.userContext.userId).toBe('uuid-1');
    expect(req.userContext.email).toBe('test@test.com');
    expect(req.userContext.providerRoles).toEqual({ 'prov-1': 'PROVIDER_ADMIN' });
    expect(req.userContext.providerIds).toEqual(['prov-1']);
    expect(next).toHaveBeenCalled();
  });

  // Fails CLOSED since the shim was retired (2026-10-07): a storage error grants no provider role, where the
  // shim used to fall back to DIRECTOR at the legacy users.provider_id home.
  it('grants no provider role when user_providers throws, rather than falling back to the legacy home', async () => {
    const user = { email: 'test@test.com', userId: 'uuid-2', roles: ['client'], providerId: 'prov-2' };
    verifyJwtMock.mockResolvedValue({ email: 'test@test.com' });
    mockUsersService.findOne.mockResolvedValue(user);
    mockUserProviderStorage.findByUserId.mockRejectedValue(new Error('requires Postgres'));

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer valid.token' } };
    const next = vi.fn();
    await middleware.use(req, {}, next);

    expect(req.userContext).toBeDefined();
    expect(req.userContext.providerRoles).toEqual({});
    expect(next).toHaveBeenCalled();
  });

  it('hydrates multi-provider context', async () => {
    const user = { email: 'multi@test.com', userId: 'uuid-3', roles: ['client'] };
    verifyJwtMock.mockResolvedValue({ email: 'multi@test.com' });
    mockUsersService.findOne.mockResolvedValue(user);
    mockUserProviderStorage.findByUserId.mockResolvedValue([
      { userId: 'uuid-3', providerId: 'prov-a', providerRole: 'PROVIDER_ADMIN' },
      { userId: 'uuid-3', providerId: 'prov-b', providerRole: 'DIRECTOR' },
    ]);

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer valid.token' } };
    const next = vi.fn();
    await middleware.use(req, {}, next);

    expect(req.userContext.providerRoles).toEqual({
      'prov-a': 'PROVIDER_ADMIN',
      'prov-b': 'DIRECTOR',
    });
    expect(req.userContext.providerIds).toEqual(['prov-a', 'prov-b']);
  });

  it('the deprecated global admin role no longer promotes: user_providers rows are the only provider roles', async () => {
    // The shim promoted a legacy 'admin' to PROVIDER_ADMIN at the home over a DIRECTOR row (tmx@courthive.com's
    // drift). Retired 2026-10-07: migration 051 rewrote every such row as PROVIDER_ADMIN, and on prod none
    // remained to rewrite. A DIRECTOR row now means DIRECTOR.
    const user = {
      email: 'admin@test.com',
      userId: 'uuid-4',
      roles: ['client', 'admin', 'score'],
      providerId: 'prov-home',
    };
    verifyJwtMock.mockResolvedValue({ email: 'admin@test.com' });
    mockUsersService.findOne.mockResolvedValue(user);
    mockUserProviderStorage.findByUserId.mockResolvedValue([
      { userId: 'uuid-4', providerId: 'prov-home', providerRole: 'DIRECTOR' },
    ]);

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer valid.token' } };
    const next = vi.fn();
    await middleware.use(req, {}, next);

    expect(req.userContext.providerRoles).toEqual({ 'prov-home': 'DIRECTOR' });
  });

  it('calls next without setting user when token decode fails', async () => {
    verifyJwtMock.mockRejectedValue(new Error('Invalid token'));

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer bad.token' } };
    const next = vi.fn();
    await middleware.use(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('calls next without setting user when decoded email is null', async () => {
    verifyJwtMock.mockResolvedValue({ email: null });

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer token' } };
    const next = vi.fn();
    await middleware.use(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('handles authorization header with no token part', async () => {
    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer' } };
    const next = vi.fn();
    await middleware.use(req, {}, next);

    expect(next).toHaveBeenCalled();
    // parts[1] is undefined, so decode shouldn't be called
    expect(verifyJwtMock).not.toHaveBeenCalled();
  });

  it('attaches req.user but skips userContext for pure hiveid tokens', async () => {
    const user = { email: 'jane@test.com', userId: 'uuid-h', roles: [], providerId: null };
    verifyJwtMock.mockResolvedValue({ email: 'jane@test.com', aud: 'hiveid' });
    mockUsersService.findOne.mockResolvedValue(user);

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer hiveid.token' } };
    const next = vi.fn();
    await middleware.use(req, {}, next);

    expect(req.user).toBe(user);
    expect(req.userContext).toBeUndefined();
    expect(mockUserProviderStorage.findByUserId).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('hydrates userContext for admin+hiveid array audience tokens', async () => {
    const user = { email: 'admin@test.com', userId: 'uuid-ah', roles: ['client'], providerId: 'prov-a' };
    verifyJwtMock.mockResolvedValue({ email: 'admin@test.com', aud: ['admin', 'hiveid'] });
    mockUsersService.findOne.mockResolvedValue(user);
    mockUserProviderStorage.findByUserId.mockResolvedValue([
      { userId: 'uuid-ah', providerId: 'prov-a', providerRole: 'DIRECTOR' },
    ]);

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer dual.token' } };
    const next = vi.fn();
    await middleware.use(req, {}, next);

    expect(req.userContext).toBeDefined();
    expect(req.userContext.providerRoles).toEqual({ 'prov-a': 'DIRECTOR' });
  });

  it("carries the TOKEN's chosen provider into userContext, not the user row's legacy provider_id", async () => {
    const user = { email: 'multi@test.com', userId: 'uuid-m', roles: ['client'], providerId: 'legacy-home' };
    verifyJwtMock.mockResolvedValue({
      email: 'multi@test.com',
      aud: 'admin',
      providerId: 'chosen',
      providerSelectionRequired: false,
    });
    mockUsersService.findOne.mockResolvedValue(user);
    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer token' } };
    await middleware.use(req, {}, vi.fn());
    expect(req.userContext.actingProviderId).toBe('chosen');
    expect(req.userContext.providerSelectionPending).toBeUndefined();
  });

  it('marks a session that has not chosen its provider', async () => {
    verifyJwtMock.mockResolvedValue({ email: 'multi@test.com', aud: 'admin', providerSelectionRequired: true });
    mockUsersService.findOne.mockResolvedValue({ email: 'multi@test.com', userId: 'uuid-m', roles: ['client'] });
    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer token' } };
    await middleware.use(req, {}, vi.fn());
    expect(req.userContext.actingProviderId).toBeUndefined();
    expect(req.userContext.providerSelectionPending).toBe(true);
  });
});
