/**
 * Tournament lifecycle classification — the PRIMARY routing dimension for
 * tournament-affinity sharding (planning/CFS_TOURNAMENT_AFFINITY_SHARDING.md).
 *
 * SHIPS READ-ONLY. Nothing routes on this today. It is recorded alongside load
 * telemetry for two reasons, both of which have to be settled before any
 * routing can depend on it:
 *
 *   1. It sizes the future pools with real numbers rather than guesses.
 *   2. It falsifies the assumption the whole model rests on — that the
 *      lifecycle dates carried by real records are accurate enough to route on.
 *      A record classified `archive` that is receiving live mutations is
 *      exactly the contradiction that would, under real routing, serve someone's
 *      live event from the archive pool. Recording the class next to observed
 *      mutation activity makes that measurable instead of hypothetical.
 *
 * Deliberately a pure function of the record plus `now` — no storage, no
 * placement table, no clock of its own. That keeps it trivially testable and
 * keeps the classification reproducible for any (record, instant) pair.
 */

export const LIFECYCLE_CLASS = {
  ARCHIVE: 'archive',
  CONSTRUCTION: 'construction',
  LIVE: 'live',
  UNKNOWN: 'unknown',
} as const;

export type LifecycleClass = (typeof LIFECYCLE_CLASS)[keyof typeof LIFECYCLE_CLASS];

/**
 * Days after `endDate` during which a tournament is still treated as `live`.
 *
 * Fail toward `live`: demoting a tournament that is still being played is a
 * real outage, while demoting one late costs nothing but a little headroom in
 * the wrong pool. This grace window is the date-only half of that bias — the
 * activity latch (a tournament with connected clients or recent mutations never
 * demotes) is the other half, and belongs with the router, not here.
 */
export const LIVE_GRACE_DAYS = 2;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse a TODS `YYYY-MM-DD` date as UTC midnight. Returns null if unusable. */
function parseDateOnly(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Classify a tournament record at an instant.
 *
 * `UNKNOWN` is returned when the record carries no usable dates at all. That is
 * deliberately NOT folded into `archive`: an unusable-dates record is a data
 * problem to be surfaced, and silently filing it under the pool that receives
 * the fewest resources is the failure mode this classification exists to catch.
 */
export function classifyTournament(tournamentRecord: any, now: number = Date.now()): LifecycleClass {
  if (!tournamentRecord) return LIFECYCLE_CLASS.UNKNOWN;

  const start = parseDateOnly(tournamentRecord.startDate);
  const end = parseDateOnly(tournamentRecord.endDate);
  const activeDates: unknown[] = Array.isArray(tournamentRecord.activeDates) ? tournamentRecord.activeDates : [];

  // An explicit activeDates entry for today outranks the start/end window —
  // it is the more specific statement about when play actually happens.
  const today = Math.floor(now / MS_PER_DAY) * MS_PER_DAY;
  if (activeDates.some((date) => parseDateOnly(date) === today)) return LIFECYCLE_CLASS.LIVE;

  if (start === null && end === null) return LIFECYCLE_CLASS.UNKNOWN;

  if (start !== null && now < start) return LIFECYCLE_CLASS.CONSTRUCTION;
  if (end !== null && now > end + LIVE_GRACE_DAYS * MS_PER_DAY) return LIFECYCLE_CLASS.ARCHIVE;

  // Inside the window, or bounded on only one side and not past it.
  return LIFECYCLE_CLASS.LIVE;
}
