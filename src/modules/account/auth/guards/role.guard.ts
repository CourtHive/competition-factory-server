import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Roles } from '../decorators/roles.decorator';
import { Reflector } from '@nestjs/core';

/**
 * This guard is used to protect routes based on the user's role.
 */

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.get(Roles, context.getHandler());
    if (!roles) return true;
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const hasRole = () =>
      !!user.roles.find((role) => !!roles.find((item) => item.toLowerCase() === role.toLowerCase()));

    return user && Array.isArray(user.roles) && hasRole();
  }
}
