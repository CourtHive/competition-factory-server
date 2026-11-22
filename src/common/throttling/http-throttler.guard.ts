import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';

// @nestjs/throttler stays at 6.5.0 — its latest — while the rest of the Nest stack is on 12.
// Its peerDependencies still cap @nestjs/common and @nestjs/core at ^11.0.0, so an install
// warns. It works: verified against Nest 12 with a live probe, 14 rapid POSTs to /auth/login
// returning 10x 401 then 4x 429. pnpm does not enforce peer ranges by default, so the stale
// range warns rather than blocks. Revisit when a v12-peered release ships.

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
 *
 * `DISABLE_HTTP_THROTTLE=true` disables all HTTP rate limiting for the process.
 * Default OFF — intended ONLY for local dev / CI e2e, where a suite legitimately
 * fires far more auth requests per minute than the per-IP login limit allows
 * (e2e seeds + per-test logins). NEVER set in production.
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  // A finite allowance for a configured, authenticated identity on the simulation's two load routes.
  // Key its requests separately so this allowance cannot consume another user's per-IP bucket.
  protected handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const userId = process.env.SIMULATION_FACTORY_USER_ID;
    if (
      userId &&
      props.context.getClass().name === 'FactoryController' &&
      ['queryTournamentRecords', 'executionQueue'].includes(props.context.getHandler().name) &&
      props.context.switchToHttp().getRequest().userContext?.userId === userId
    ) {
      const limit = Number(process.env.SIMULATION_FACTORY_LIMIT_PER_MINUTE);
      if (Number.isSafeInteger(limit) && limit > props.limit && limit <= 60_000 && props.ttl === 60_000)
        return super.handleRequest({ ...props, limit, getTracker: () => 'simulation-user:' + userId });
    }
    return super.handleRequest(props);
  }

  protected shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (process.env.DISABLE_HTTP_THROTTLE === 'true') return Promise.resolve(true);
    if (context.getType() !== 'http') return Promise.resolve(true);
    const request = context.switchToHttp().getRequest();
    return Promise.resolve(Boolean(request?.provider?.providerId || request?.provisioner));
  }
}
