/**
 * Whether the built-in dev super-admin (`TEST_EMAIL`, `users.service.ts`) may be offered.
 *
 * That user has a published password, every role including SUPER_ADMIN, and no `users` row, so it is
 * resolved before the database is consulted. `APP_MODE=development` alone used to enable it, so any
 * host running in development mode against a shared database offered anyone who had read this
 * repository a super-admin login over that database (found 2026-10-24).
 *
 * So the mode is necessary but no longer sufficient. The database must also be on this machine's
 * loopback interface, which is what a developer's laptop and CI both have, and what no shared or
 * deployed host has. A Unix-socket `PG_HOST` (a path) is refused too: production nest connects that way.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type DevTestUserDecision = {
  allowed: boolean;
  /** Why development mode was refused it; absent when the mode is not development at all. */
  refusedBecause?: string;
};

export function devTestUserDecision(env: Record<string, string | undefined> = process.env): DevTestUserDecision {
  if (env.APP_MODE !== 'development') return { allowed: false };
  if (env.NODE_ENV === 'production') return { allowed: false, refusedBecause: 'NODE_ENV is production' };
  // Same default as `getPostgresConfig()`: an unset host is localhost.
  const host = env.PG_HOST || 'localhost';
  if (!LOOPBACK_HOSTS.has(host)) {
    return { allowed: false, refusedBecause: `PG_HOST "${host}" is not a loopback address` };
  }
  return { allowed: true };
}
