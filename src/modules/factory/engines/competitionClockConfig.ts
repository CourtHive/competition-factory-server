import { tools } from 'tods-competition-factory';

/**
 * Pin the factory's clocks for a DEDICATED DEMO PROCESS. Slice 0-d.5 of
 * Mentat/planning/COMPETITION_CLOCK_INSTRUMENTATION.md.
 *
 * `COMPETITION_CLOCK_PAUSED_AT=<ISO instant>` binds both the factory's competition clock and its
 * record clock to that one instant, held for the life of the process. That is the only online
 * configuration the plan's activation gate allows before authoritative replay: client and server at
 * an identical PAUSED instant. A clock that moves is not offered here, on purpose.
 *
 * Fail-closed (architectural standards A3): refused on a production host, and refused for an
 * unreadable instant, by throwing at boot. A server must never serve real traffic on a frozen clock,
 * and a demo must never silently run on the wall clock because its pin did not parse.
 */
export const COMPETITION_CLOCK_ENV = 'COMPETITION_CLOCK_PAUSED_AT';

let pinnedAt: string | undefined;

export function configureCompetitionClock(env: Record<string, string | undefined> = process.env): {
  pinnedAt?: string;
} {
  const raw = env[COMPETITION_CLOCK_ENV];
  if (!raw) return {};
  if (env.NODE_ENV === 'production' || env.APP_MODE === 'production') {
    throw new Error(`${COMPETITION_CLOCK_ENV} is set on a production host; refusing to start on a pinned clock`);
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new Error(`${COMPETITION_CLOCK_ENV}=${raw} is not a readable instant`);

  tools.setCompetitionClock({ nowMs: () => ms });
  tools.setClock(ms);
  pinnedAt = new Date(ms).toISOString();
  return { pinnedAt };
}

/** The pinned instant, for /admin/config/readiness: a pinned server must be visible, not discovered. */
export function getPinnedCompetitionClock(): string | undefined {
  return pinnedAt;
}

/** Tests only: undo a pin. */
export function resetCompetitionClock(): void {
  tools.setCompetitionClock();
  tools.setClock();
  pinnedAt = undefined;
}
