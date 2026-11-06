import { basename } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * The live-stack specs' super-admin: a real `users` row, created and signed for by
 * `src/tests/helpers/sessionToken.ts`. CFS has no built-in account any more; login is the
 * identity provider's.
 */
export const TEST_EMAIL = 'e2e-superadmin@courthive.test';

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
