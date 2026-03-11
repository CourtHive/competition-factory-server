import { AuthMiddleware } from './auth.middleware';

describe('AuthMiddleware', () => {
  let middleware: AuthMiddleware;
  let mockAuthService: any;
  let mockUsersService: any;

  beforeEach(() => {
    mockAuthService = {
      decode: jest.fn(),
    };
    mockUsersService = {
      findOne: jest.fn(),
    };
    middleware = new AuthMiddleware(mockAuthService, mockUsersService);
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

  it('decodes token and sets user on request', async () => {
    const user = { email: 'test@test.com', roles: ['admin'] };
    mockAuthService.decode.mockResolvedValue({ email: 'test@test.com' });
    mockUsersService.findOne.mockResolvedValue(user);

    const req: any = { baseUrl: '/api', headers: { authorization: 'Bearer valid.token' } };
    const next = jest.fn();
    await middleware.use(req, {}, next);

    expect(mockAuthService.decode).toHaveBeenCalledWith('valid.token');
    expect(mockUsersService.findOne).toHaveBeenCalledWith('test@test.com');
    expect(req.user).toBe(user);
    expect(next).toHaveBeenCalled();
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
