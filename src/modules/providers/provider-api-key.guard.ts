import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Guard for provider-key-native endpoints (everything under /provider-key/*).
 *
 * Ensures request.provider was set by ProviderApiKeyMiddleware. Use with
 * @UseGuards(ProviderApiKeyGuard) on the provider-key controller. The
 * downstream handler can then trust request.provider.providerId as the
 * authenticated scope.
 */
@Injectable()
export class ProviderApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    if (!request.provider?.providerId) {
      throw new UnauthorizedException('Provider API key required');
    }

    return true;
  }
}
