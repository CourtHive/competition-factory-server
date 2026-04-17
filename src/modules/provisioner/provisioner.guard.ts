import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Guard for provisioner-native endpoints.
 * Ensures request.provisioner was set by ProvisionerMiddleware.
 * Apply with @UseGuards(ProvisionerGuard) on provisioner controllers.
 */
@Injectable()
export class ProvisionerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    if (!request.provisioner) {
      throw new UnauthorizedException('Provisioner API key required');
    }

    return true;
  }
}

/**
 * Guard for provisioner endpoints that require X-Provider-Id header
 * and validate the provisioner manages the specified provider.
 */
@Injectable()
export class ProvisionerProviderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    if (!request.provisioner) {
      throw new UnauthorizedException('Provisioner API key required');
    }

    const providerId = request.headers['x-provider-id'];
    if (!providerId) {
      throw new ForbiddenException('X-Provider-Id header required');
    }

    if (!request.provisionerRelationship) {
      throw new ForbiddenException('Provider not managed by this provisioner');
    }

    return true;
  }
}

/**
 * Guard that requires the provisioner to be the owner of the provider
 * (not subsidiary). For operations like config updates, subsidiary grants.
 */
@Injectable()
export class ProvisionerOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    if (!request.provisioner) {
      throw new UnauthorizedException('Provisioner API key required');
    }

    if (request.provisionerRelationship !== 'owner') {
      throw new ForbiddenException('Only the owning provisioner can perform this action');
    }

    return true;
  }
}
