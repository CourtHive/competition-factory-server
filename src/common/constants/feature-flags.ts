/**
 * Feature flags — read lazily from environment variables.
 *
 * These are functions, not constants, because NestJS's ConfigModule may
 * load the .env file AFTER module-level constants are evaluated. Reading
 * process.env at call time ensures the flag reflects the actual .env state.
 *
 * When a flag is OFF, the guarded code path falls through to legacy
 * behavior. This lets us land schema + helpers + endpoints without
 * immediately changing user-visible behavior.
 */

/** When ON, tournament read/write paths enforce per-user visibility via checkTournamentAccess. */
export function isTournamentAccessScopingEnabled(): boolean {
  return process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING === 'true';
}
