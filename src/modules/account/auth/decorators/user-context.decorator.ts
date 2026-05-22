import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Multi-provider user context, hydrated per-request by AuthMiddleware.
 *
 * Global roles (SUPER_ADMIN, CLIENT, etc.) come from the JWT.
 * Provider-scoped roles (PROVIDER_ADMIN, DIRECTOR) are resolved from
 * the `user_providers` table at request time — they are NOT in the JWT,
 * so role changes take effect immediately without forced re-login.
 */
export interface UserContext {
  /** UUID primary key from the users table. */
  userId: string;
  /** Login email — the UNIQUE INDEX, not the PK. */
  email: string;
  /** True if globalRoles includes SUPER_ADMIN. */
  isSuperAdmin: boolean;
  /** Capability roles from users.roles JSONB (present in JWT). */
  globalRoles: string[];
  /** Per-provider role map, keyed by providerId. */
  providerRoles: Record<string, string>;
  /** Convenience: Object.keys(providerRoles). */
  providerIds: string[];
  /**
   * Flattened set of providerIds whose owner / subsidiary relationship
   * is held by ANY provisioner the caller administers. Empty for users
   * without the PROVISIONER role; populated by buildUserContext for
   * users with provisioner_id rows in `user_provisioners`.
   *
   * Authorization checks that previously required `providerIds.includes`
   * should also accept hits in `provisionerProviderIds` — the impersonation
   * handoff from /admin lets a provisioner act on providers they manage
   * via the provisioner relationship rather than a direct user_providers
   * row.
   *
   * Optional so existing UserContext fixtures (tests, the provisioner
   * middleware's API-key path) don't have to spell out an empty array
   * — all consumers treat absent-or-empty as "no provisioner access".
   */
  provisionerProviderIds?: string[];
}

/**
 * Parameter decorator that injects the hydrated UserContext from the request.
 * Returns undefined for unauthenticated / @Public() routes.
 *
 * Usage:
 *   @Get('me')
 *   getMe(@UserCtx() ctx: UserContext) { return ctx; }
 */
export const UserCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserContext | undefined => {
  const request = ctx.switchToHttp().getRequest();
  return request.userContext;
});
