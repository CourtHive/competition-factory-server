import { AuthMiddleware } from './auth.middleware';

// The middleware verifies tokens via the neutral verifyJwt (no longer the MOVE
// AuthService.decode), so we mock the function. verifyJwtMock stands in for the
// former AuthService.decode — same behavioral assertions.
jest.mock('src/common/auth/verifyJwt', () => ({ verifyJwt: jest.fn() }));
import { verifyJwt } from 'src/common/auth/verifyJwt';
const verifyJwtMock = verifyJwt as jest.Mock;

describe('AuthMiddleware', () => {
  let middleware: AuthMiddleware;
  let mockUsersService: any;
  let mockUserProviderStorage: any;

  beforeEach(() => {
    verifyJwtMock.mockReset();
    mockUsersService = {
      findOne: jest.fn(),
    };
    mockUserProviderStorage = {
      findByUserId: jest.fn().mockResolvedValue([]),
    };
    const mockUserProvisionerStorage: any = { findProvisionerIdsByUser: jest.fn().mockResolvedValue([]) };
    const mockProvisionerProviderStorage: any = { findByProvisioner: jest.fn().mockResolvedValue([]) };
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
    const next = jest.fn();
    await middleware.use(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(verifyJwtMock).not.toHaveBeenCalled();
  });

  it('calls next without setting user when no authorization header', async () => {
    const req: any = { baseUrl: '/api', headers: {} };
    const next = jest.fn();
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
    const next = jest.fn();
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

  it('falls back to legacy providerId when user_providers throws', async () => {
    const user = { email: 'test@test.com', userId: 'uuid-2', roles: ['client'], providerId: 'prov-2' };
    verifyJwtMock.mockResolvedValue({ email: 'test@test.com' });
    mockUsersService.findOne.mockResolvedValue(user);
    mockUserProviderStorage.findByUserId.mockRejectedValue(new Error('requires Postgres'));

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer valid.token' } };
    const next = jest.fn();
    await middleware.use(req, {}, next);

    expect(req.userContext).toBeDefined();
    expect(req.userContext.providerRoles).toEqual({ 'prov-2': 'DIRECTOR' });
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
    const next = jest.fn();
    await middleware.use(req, {}, next);

    expect(req.userContext.providerRoles).toEqual({
      'prov-a': 'PROVIDER_ADMIN',
      'prov-b': 'DIRECTOR',
    });
    expect(req.userContext.providerIds).toEqual(['prov-a', 'prov-b']);
  });

  it('back-compat: legacy admin role overrides DIRECTOR in user_providers for the home provider', async () => {
    // Reproduces tmx@courthive.com's drift: user_providers row was backfilled
    // as DIRECTOR before 'admin' was added to users.roles, and the legacy
    // role-edit flow doesn't sync to user_providers. The shim must promote
    // unconditionally on every buildUserContext call so the legacy 'admin'
    // role stays authoritative until it's fully retired.
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
    const next = jest.fn();
    await middleware.use(req, {}, next);

    expect(req.userContext.providerRoles).toEqual({ 'prov-home': 'PROVIDER_ADMIN' });
  });

  it('calls next without setting user when token decode fails', async () => {
    verifyJwtMock.mockRejectedValue(new Error('Invalid token'));

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer bad.token' } };
    const next = jest.fn();
    await middleware.use(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('calls next without setting user when decoded email is null', async () => {
    verifyJwtMock.mockResolvedValue({ email: null });

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer token' } };
    const next = jest.fn();
    await middleware.use(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('handles authorization header with no token part', async () => {
    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer' } };
    const next = jest.fn();
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
    const next = jest.fn();
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
    const next = jest.fn();
    await middleware.use(req, {}, next);

    expect(req.userContext).toBeDefined();
    expect(req.userContext.providerRoles).toEqual({ 'prov-a': 'DIRECTOR' });
  });
});
