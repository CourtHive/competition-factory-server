import { AuthGuard } from './auth.guard';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let jwtService: JwtService;
  let reflector: Reflector;

  beforeEach(() => {
    jwtService = new JwtService({ secret: 'test-secret' });
    reflector = new Reflector();
    guard = new AuthGuard(jwtService, reflector);
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  function createMockContext(headers: Record<string, string> = {}, isPublic = false) {
    const mockReflector = jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);
    return {
      context: {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({ headers, user: undefined }),
        }),
      } as any,
      mockReflector,
    };
  }

  it('allows access for @Public() routes', async () => {
    const { context } = createMockContext({}, true);
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('throws UnauthorizedException when no Authorization header', async () => {
    const { context } = createMockContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for non-Bearer token', async () => {
    const { context } = createMockContext({ authorization: 'Basic abc123' });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for invalid JWT', async () => {
    const { context } = createMockContext({ authorization: 'Bearer invalid.jwt.token' });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('allows access and sets user for valid JWT', async () => {
    const payload = { email: 'test@test.com', roles: ['admin'] };
    const token = jwtService.sign(payload, { secret: 'test-secret' });
    const request: any = { headers: { authorization: `Bearer ${token}` }, user: undefined };
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(request.user).toBeDefined();
    expect(request.user.email).toBe('test@test.com');
  });
});
