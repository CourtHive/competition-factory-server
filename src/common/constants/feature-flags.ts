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
import { Logger } from '@nestjs/common';

const logger = new Logger('FeatureFlags');
let warnedAccessScopingUnset = false;

/**
 * When ON, tournament read/write paths enforce per-user visibility via checkTournamentAccess.
 *
 * **Fail-closed by design.** This previously read `=== 'true'`, so an unset or
 * misspelled variable silently disabled every access check and made every user
 * behave as PROVIDER_ADMIN — the exact `if (!x) return <permissive default>`
 * shape banned by architectural standard A3, sitting in the access-control flag
 * itself. The failure mode was a deploy that forgot the variable, which is the
 * likeliest mistake and the one with the widest blast radius.
 *
 * Absence now means ENABLED. Disabling is possible but must be deliberate and
 * explicit: `ENABLE_TOURNAMENT_ACCESS_SCOPING=false`.
 *
 * The unset case is logged once rather than silently defaulted, per A2
 * (fail-soft must surface) — an operator who expected scoping off needs to see
 * why it is on.
 */
export function isTournamentAccessScopingEnabled(): boolean {
  const raw = process.env.ENABLE_TOURNAMENT_ACCESS_SCOPING;

  if (raw === undefined || raw === '') {
    if (!warnedAccessScopingUnset) {
      warnedAccessScopingUnset = true;
      logger.warn(
        'ENABLE_TOURNAMENT_ACCESS_SCOPING is not set — defaulting to ENABLED (fail-closed). ' +
          'Set it to "false" to disable per-user tournament scoping deliberately.',
      );
    }
    return true;
  }

  return raw !== 'false';
}

/** Test-only: reset the one-shot unset warning so each spec can assert it. */
export function __resetFeatureFlagWarnings(): void {
  warnedAccessScopingUnset = false;
}
