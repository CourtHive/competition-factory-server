import { AuthGuard, audienceMatches } from './auth.guard';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AUDIENCE_KEY } from '../decorators/audience.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

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

  it('allows access when request.provisioner is already set (provisioner middleware)', async () => {
    const request: any = {
      headers: { authorization: 'Bearer prov_sk_live_testkey' },
      provisioner: { provisionerId: 'p1', name: 'IONSport' },
    };
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

  describe('audience handling', () => {
    function ctxWithToken(token: string, decoratorReturns: { isPublic?: boolean; audience?: string[] | undefined }) {
      const request: any = { headers: { authorization: `Bearer ${token}` }, user: undefined };
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => {
        if (key === IS_PUBLIC_KEY) return decoratorReturns.isPublic ?? false;
        if (key === AUDIENCE_KEY) return decoratorReturns.audience;
        return undefined;
      });
      return {
        request,
        context: {
          getHandler: () => ({}),
          getClass: () => ({}),
          switchToHttp: () => ({ getRequest: () => request }),
        } as any,
      };
    }

    it('rejects hiveid-only tokens on admin routes (default audience)', async () => {
      const token = jwtService.sign({ email: 'jane@test.com', aud: 'hiveid' }, { secret: 'test-secret' });
      const { context } = ctxWithToken(token, { audience: undefined });
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('admits hiveid tokens on routes declaring @Audience(["hiveid"])', async () => {
      const token = jwtService.sign({ email: 'jane@test.com', aud: 'hiveid' }, { secret: 'test-secret' });
      const { request, context } = ctxWithToken(token, { audience: ['hiveid'] });
      const ok = await guard.canActivate(context);
      expect(ok).toBe(true);
      expect(request.user.email).toBe('jane@test.com');
    });

    it('admits array-aud admin+hiveid tokens on admin routes', async () => {
      const token = jwtService.sign(
        { email: 'admin@test.com', aud: ['admin', 'hiveid'] },
        { secret: 'test-secret' },
      );
      const { context } = ctxWithToken(token, { audience: undefined });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('treats legacy tokens (no aud claim) as admin', async () => {
      const token = jwtService.sign({ email: 'legacy@test.com' }, { secret: 'test-secret' });
      const { context } = ctxWithToken(token, { audience: undefined });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('rejects admin-only tokens on hiveid-required routes', async () => {
      const token = jwtService.sign({ email: 'admin@test.com', aud: 'admin' }, { secret: 'test-secret' });
      const { context } = ctxWithToken(token, { audience: ['hiveid'] });
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('audienceMatches', () => {
    it('treats absent token audience as admin', () => {
      expect(audienceMatches(undefined, ['admin'])).toBe(true);
      expect(audienceMatches(undefined, ['hiveid'])).toBe(false);
    });

    it('handles string token aud', () => {
      expect(audienceMatches('hiveid', ['hiveid'])).toBe(true);
      expect(audienceMatches('admin', ['hiveid'])).toBe(false);
    });

    it('handles array token aud (any-match)', () => {
      expect(audienceMatches(['admin', 'hiveid'], ['hiveid'])).toBe(true);
      expect(audienceMatches(['admin'], ['hiveid'])).toBe(false);
      expect(audienceMatches(['admin', 'hiveid'], ['admin', 'hiveid'])).toBe(true);
    });
  });
});
