import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Roles } from '../decorators/roles.decorator';
import { Reflector } from '@nestjs/core';

/**
 * Protects routes by the user's role. `@Roles` is read from the HANDLER, then the CONTROLLER CLASS (a handler-level
 * declaration overrides the class's). Until 2026-11-08 only the handler was read, so every controller declaring
 * `@Roles` at class level — six SUPER_ADMIN controllers, provider API-key minting among them — admitted any
 * authenticated token. `role.guard.spec.ts` pins both placements against real decorator metadata.
 */

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride(Roles, [context.getHandler(), context.getClass()]);
    if (!roles) return true;
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const hasRole = () =>
      !!user.roles.find((role) => !!roles.find((item) => item.toLowerCase() === role.toLowerCase()));

    return user && Array.isArray(user.roles) && hasRole();
  }
}
