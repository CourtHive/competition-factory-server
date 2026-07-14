import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limit guard that governs only HTTP traffic and exempts trusted,
 * high-volume service callers.
 *
 * - Non-HTTP contexts (the `/tmx`, `/public`, `/hiveid` Socket.IO gateways) are
 *   skipped entirely, so live-scoring `executionQueue` mutations and public
 *   broadcast streams are never rate-limited here — the burst behavior at
 *   match-point moments must not be throttled.
 * - Requests authenticated by a provider API key (`req.provider`) or a
 *   provisioner API key (`req.provisioner`) are exempt: partner/service traffic
 *   is trusted and intentionally high-volume, and per-IP limits would break it.
 *
 * Everything else — anonymous and JWT-user REST — is subject to the default
 * limits configured in `ThrottlerModule.forRoot` (see app.module.ts).
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  protected shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return Promise.resolve(true);
    const request = context.switchToHttp().getRequest();
    return Promise.resolve(Boolean(request?.provider?.providerId || request?.provisioner));
  }
}
