import { Controller, ExecutionContext } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { Roles } from '../decorators/roles.decorator';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './role.guard';
import { join } from 'node:path';

// Real decorator metadata and a real Reflector — no spy on the reflector. The previous spec stubbed `reflector.get`,
// the very call the guard made, so it agreed with the guard by construction and could not see that a class-level
// `@Roles` was never read: six SUPER_ADMIN controllers admitted any authenticated token (found 2026-11-08).

@Controller('class-level')
@Roles(['superadmin'])
class ClassLevel {
  plain() {}
  @Roles(['client'])
  overridden() {}
}

@Controller('handler-level')
class HandlerLevel {
  @Roles(['admin', 'superadmin'])
  guarded() {}
  open() {}
}

const guard = new RolesGuard(new Reflector());
const context = (cls: any, handler: string, user: any): ExecutionContext =>
  ({
    getHandler: () => cls.prototype[handler],
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  it('enforces roles declared on the CONTROLLER CLASS', () => {
    expect(guard.canActivate(context(ClassLevel, 'plain', { roles: ['client'] }))).toBe(false);
    expect(guard.canActivate(context(ClassLevel, 'plain', { roles: ['superadmin'] }))).toBe(true);
  });

  it('lets a handler-level declaration override the class', () => {
    expect(guard.canActivate(context(ClassLevel, 'overridden', { roles: ['client'] }))).toBe(true);
    expect(guard.canActivate(context(ClassLevel, 'overridden', { roles: ['superadmin'] }))).toBe(false);
  });

  it('enforces roles declared on the handler, and allows a route that declares none', () => {
    expect(guard.canActivate(context(HandlerLevel, 'guarded', { roles: ['client'] }))).toBe(false);
    expect(guard.canActivate(context(HandlerLevel, 'guarded', { roles: ['superadmin'] }))).toBe(true);
    expect(guard.canActivate(context(HandlerLevel, 'open', { roles: ['client'] }))).toBe(true);
  });

  it('matches roles case-insensitively', () => {
    expect(guard.canActivate(context(ClassLevel, 'plain', { roles: ['SUPERADMIN'] }))).toBe(true);
  });

  it('denies a user with no roles array, and no user at all', () => {
    expect(guard.canActivate(context(ClassLevel, 'plain', { roles: 'superadmin' }))).toBe(false);
    expect(guard.canActivate(context(ClassLevel, 'plain', undefined))).toBeFalsy();
  });
});

/**
 * `@Roles` only means something under `RolesGuard` — the global AuthGuard checks authentication and audience, never
 * roles. A controller that declares `@Roles` without the guard LOOKS role-gated and admits any authenticated token.
 *
 * These four declare CLIENT/SCORE and authorize in their services (canMutateTournament / isProviderAdminFor), which is
 * the real gate; attaching the guard would start refusing tokens whose roles lack `client`, a behaviour change on live
 * routes, so it is CA's call (Mentat memory feedback_roles_decorator_inert_without_rolesguard). Anything NEW fails here.
 */
// `@UseGuards(A, RolesGuard)` counts: two provisioner controllers combine it with ProvisionerWritesMovedGuard.
const UNDER_ROLES_GUARD = /@UseGuards\([^)]*\bRolesGuard\b/;

const UNGUARDED_BY_DECISION = new Set([
  'modules/account/declarations/admin-availability.controller.ts',
  'modules/account/registrations/admin-registrations.controller.ts',
  'modules/factory/assignments.controller.ts',
  'modules/tournament-auth/tournament-token.controller.ts',
]);

describe('every controller that declares @Roles is under RolesGuard', () => {
  const root = join(__dirname, '../../../..');
  const controllers = (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.controller.ts'))
    .map((f) => f.split('\\').join('/'));

  it('found the controllers it sweeps', () => {
    // A sweep that finds nothing reports clean; assert it looked.
    expect(controllers.length).toBeGreaterThan(20);
    expect(controllers).toContain('modules/factory/admin-projection.controller.ts');
  });

  it.each(controllers)('%s', (file) => {
    const source = readFileSync(join(root, file), 'utf8');
    if (!source.includes('@Roles(') || UNGUARDED_BY_DECISION.has(file)) return;
    expect(source).toMatch(UNDER_ROLES_GUARD);
  });

  it('keeps the allow-list honest: each entry still declares @Roles without the guard', () => {
    for (const file of UNGUARDED_BY_DECISION) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source).toContain('@Roles(');
      expect(source).not.toMatch(UNDER_ROLES_GUARD);
    }
  });
});
