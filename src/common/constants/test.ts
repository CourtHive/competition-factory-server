import { basename } from 'node:path';
import { randomBytes } from 'node:crypto';

export const TEST_EMAIL = 'axel@castle.com';
export const TEST_PASSWORD = 'castle';

/**
 * Stable userId for the dev-mode test super-admin (TEST_EMAIL). A valid UUID so
 * it can be compared against `uuid`-typed `user_id` columns without a cast error.
 * The dev user has no `users` row, so this id resolves to no DB record — but its
 * presence on the JWT lets the HiveID `/me` surface (which keys off
 * `req.user.userId`) work in development instead of 401ing on an absent claim.
 */
export const TEST_USER_ID = 'de7de7de-0000-4000-8000-000000000000';

/**
 * Legacy literal — kept for non-storage assertions. Do NOT use as a
 * Postgres `tournamentId` in *.spec.ts: parallel Jest workers will race
 * on the shared row (one spec's `/factory/remove` deletes another's
 * fixture mid-request → `ERR_MISSING_TOURNAMENT`). Use
 * `testTournamentId(__filename)` instead.
 */
export const TEST = 'test';

// Per-spec unique tournamentId. Combines pid (per-worker), spec basename
// (per-file), and a random suffix (per-call) so parallel workers and
// sequential `describe` blocks each get their own Postgres row.
export function testTournamentId(specPath?: string): string {
  const tag = specPath ? basename(specPath, '.spec.ts') : 'spec';
  return `test-${process.pid}-${tag}-${randomBytes(3).toString('hex')}`;
}

// Production storage rejects records without providerId; this hatch lets
// the literal `TEST` and per-spec test IDs (anything starting with
// `test-`) save anonymously. Keep narrow — production tournamentIds are
// UUIDs or descriptive names, never beginning with `test-`.
export function isTestTournamentId(key: string): boolean {
  return key === TEST || key.startsWith('test-');
}
