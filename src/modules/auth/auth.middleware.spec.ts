import { AuthMiddleware } from './auth.middleware';

describe('AuthMiddleware', () => {
  let middleware: AuthMiddleware;
  let mockAuthService: any;
  let mockUsersService: any;
  let mockUserProviderStorage: any;

  beforeEach(() => {
    mockAuthService = {
      decode: jest.fn(),
    };
    mockUsersService = {
      findOne: jest.fn(),
    };
    mockUserProviderStorage = {
      findByUserId: jest.fn().mockResolvedValue([]),
    };
    middleware = new AuthMiddleware(mockAuthService, mockUsersService, mockUserProviderStorage);
  });

  it('calls next immediately for empty baseUrl', async () => {
    const req: any = { baseUrl: '', headers: {} };
    const next = jest.fn();
    await middleware.use(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(mockAuthService.decode).not.toHaveBeenCalled();
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
    mockAuthService.decode.mockResolvedValue({ email: 'test@test.com' });
    mockUsersService.findOne.mockResolvedValue(user);
    mockUserProviderStorage.findByUserId.mockResolvedValue([
      { userId: 'uuid-1', providerId: 'prov-1', providerRole: 'PROVIDER_ADMIN' },
    ]);

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer valid.token' } };
    const next = jest.fn();
    await middleware.use(req, {}, next);

    expect(mockAuthService.decode).toHaveBeenCalledWith('valid.token');
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
    mockAuthService.decode.mockResolvedValue({ email: 'test@test.com' });
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
    mockAuthService.decode.mockResolvedValue({ email: 'multi@test.com' });
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

  it('calls next without setting user when token decode fails', async () => {
    mockAuthService.decode.mockRejectedValue(new Error('Invalid token'));

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer bad.token' } };
    const next = jest.fn();
    await middleware.use(req, {}, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('calls next without setting user when decoded email is null', async () => {
    mockAuthService.decode.mockResolvedValue({ email: null });

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
    expect(mockAuthService.decode).not.toHaveBeenCalled();
  });
});
