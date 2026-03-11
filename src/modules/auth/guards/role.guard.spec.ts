import { RolesGuard } from './role.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createMockContext(user: any): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows access when no roles are required', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);
    const context = createMockContext({ roles: ['client'] });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when user has required role', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(['admin']);
    const context = createMockContext({ roles: ['admin', 'client'] });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies access when user lacks required role', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(['superadmin']);
    const context = createMockContext({ roles: ['client'] });
    expect(guard.canActivate(context)).toBe(false);
  });

  it('performs case-insensitive role matching', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(['ADMIN']);
    const context = createMockContext({ roles: ['admin'] });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies access when user has no roles array', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(['admin']);
    const context = createMockContext({ roles: 'admin' }); // string, not array
    expect(guard.canActivate(context)).toBe(false);
  });

  it('returns falsy when no user object', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(['admin']);
    const context = createMockContext(undefined);
    expect(guard.canActivate(context)).toBeFalsy();
  });

  it('allows when user has any of the required roles', () => {
    jest.spyOn(reflector, 'get').mockReturnValue(['admin', 'superadmin']);
    const context = createMockContext({ roles: ['superadmin'] });
    expect(guard.canActivate(context)).toBe(true);
  });
});
