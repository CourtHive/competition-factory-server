import { SocketGuard } from './socket.guard';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AUDIENCE_KEY } from '../decorators/audience.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('SocketGuard', () => {
  let guard: SocketGuard;
  let jwtService: JwtService;
  let reflector: Reflector;

  beforeEach(() => {
    jwtService = new JwtService({ secret: 'test-secret' });
    reflector = new Reflector();
    guard = new SocketGuard(jwtService, reflector);
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  function createMockWsContext(authHeader?: string, isPublic = false) {
    const emittedEvents: any[] = [];
    const request: any = { user: undefined };

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);

    const client = {
      handshake: { headers: { authorization: authHeader } },
      emit: (event: string, data: any) => emittedEvents.push({ event, data }),
      data: {} as any,
    };

    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToWs: () => ({ getClient: () => client }),
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;

    return { context, client, emittedEvents, request };
  }

  it('allows access for @Public() routes', async () => {
    const { context } = createMockWsContext(undefined, true);
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('returns false and emits exception when no token', async () => {
    const { context, emittedEvents } = createMockWsContext(undefined);
    const result = await guard.canActivate(context);
    expect(result).toBe(false);
    expect(emittedEvents).toEqual([{ event: 'exception', data: { message: 'Not logged in or token expired' } }]);
  });

  it('returns false and emits exception for non-Bearer token', async () => {
    const { context, emittedEvents } = createMockWsContext('Basic abc123');
    const result = await guard.canActivate(context);
    expect(result).toBe(false);
    expect(emittedEvents.length).toBe(1);
  });

  it('returns false and emits exception for invalid JWT', async () => {
    const { context, emittedEvents } = createMockWsContext('Bearer invalid.jwt.token');
    const result = await guard.canActivate(context);
    expect(result).toBe(false);
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0].event).toBe('exception');
  });

  it('allows access for valid JWT without role requirements', async () => {
    const payload = { email: 'test@test.com', roles: ['admin'] };
    const token = jwtService.sign(payload, { secret: 'test-secret' });
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);

    const { context, request } = createMockWsContext(`Bearer ${token}`);
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(request.user).toBeDefined();
    expect(request.user.email).toBe('test@test.com');
  });

  it('allows access when user has required role', async () => {
    const payload = { email: 'test@test.com', roles: ['admin'] };
    const token = jwtService.sign(payload, { secret: 'test-secret' });
    jest.spyOn(reflector, 'get').mockReturnValue(['admin']);

    const { context } = createMockWsContext(`Bearer ${token}`);
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('rejects when user lacks required role', async () => {
    const payload = { email: 'test@test.com', roles: ['client'] };
    const token = jwtService.sign(payload, { secret: 'test-secret' });
    jest.spyOn(reflector, 'get').mockReturnValue(['superadmin']);

    const { context } = createMockWsContext(`Bearer ${token}`);
    await expect(guard.canActivate(context)).rejects.toThrow('Unauthorized access');
  });

  describe('audience handling', () => {
    function ctxWithAud(token: string, audience?: string[]) {
      const emittedEvents: any[] = [];
      const request: any = { user: undefined };
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === AUDIENCE_KEY) return audience;
        return undefined;
      });
      jest.spyOn(reflector, 'get').mockReturnValue(undefined);
      const client = {
        handshake: { headers: { authorization: `Bearer ${token}` } },
        emit: (event: string, data: any) => emittedEvents.push({ event, data }),
        data: {} as any,
      };
      const context = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToWs: () => ({ getClient: () => client }),
        switchToHttp: () => ({ getRequest: () => request }),
      } as any;
      return { context, client, emittedEvents, request };
    }

    it('rejects hiveid-only tokens on admin namespaces (default audience)', async () => {
      const token = jwtService.sign({ email: 'jane@test.com', aud: 'hiveid' }, { secret: 'test-secret' });
      const { context, emittedEvents } = ctxWithAud(token, undefined);
      const result = await guard.canActivate(context);
      expect(result).toBe(false);
      expect(emittedEvents[0].event).toBe('exception');
      expect(emittedEvents[0].data.message).toMatch(/audience/i);
    });

    it('admits hiveid tokens on @Audience(["hiveid"]) namespaces', async () => {
      const token = jwtService.sign(
        { email: 'jane@test.com', aud: 'hiveid', personId: 'p-1' },
        { secret: 'test-secret' },
      );
      const { context, client } = ctxWithAud(token, ['hiveid']);
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(client.data.user.personId).toBe('p-1');
    });

    it('rejects admin-only tokens on hiveid namespaces', async () => {
      const token = jwtService.sign({ email: 'admin@test.com', aud: 'admin' }, { secret: 'test-secret' });
      const { context, emittedEvents } = ctxWithAud(token, ['hiveid']);
      const result = await guard.canActivate(context);
      expect(result).toBe(false);
      expect(emittedEvents[0].event).toBe('exception');
    });

    it('treats legacy no-aud tokens as admin (back-compat for in-flight TMX sessions)', async () => {
      const token = jwtService.sign({ email: 'legacy@test.com' }, { secret: 'test-secret' });
      const { context } = ctxWithAud(token, undefined);
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('admits dual-audience tokens on the admin namespace (default)', async () => {
      const token = jwtService.sign(
        { email: 'dual@test.com', aud: ['admin', 'hiveid'] },
        { secret: 'test-secret' },
      );
      const { context } = ctxWithAud(token, undefined);
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('admits dual-audience tokens on the hiveid namespace', async () => {
      const token = jwtService.sign(
        { email: 'dual@test.com', aud: ['admin', 'hiveid'] },
        { secret: 'test-secret' },
      );
      const { context } = ctxWithAud(token, ['hiveid']);
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });
});
