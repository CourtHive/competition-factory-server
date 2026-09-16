/**
 * Paging for `POST /provider/my-calendars`.
 *
 * The response used to be unbounded: every scoped tournament of every target
 * calendar, in one payload. On 2026-09-15 that returned 49,000+ entries to a
 * browser (see `ProvidersService.resolveTargetAbbrs` for how the scope got that
 * wide). Capping the scope removed that particular blast radius; capping the
 * *page* is what stops any single provider growing into the next one.
 *
 * Standard A7 — no unbounded cross-tournament query on a read surface.
 *
 * ## Known limit, stated rather than hidden
 *
 * This bounds the **wire payload**, not the read. A calendar is one JSONB array
 * in a single `calendars` row, so the whole array is still read and parsed
 * before it can be scoped and sliced. Bounding the read as well means
 * normalising the calendar to one row per tournament, so role scoping and the
 * window can both run in SQL — a migration, tracked separately. Until then the
 * per-request cost is linear in one provider's calendar, never in the corpus.
 */

/** Page size when the caller names none. */
export const DEFAULT_CALENDAR_PAGE_SIZE = 500;

/** Hard ceiling. A caller asking for more gets this, not an unbounded read. */
export const MAX_CALENDAR_PAGE_SIZE = 1000;

export interface MyCalendarsParams {
  providerAbbr?: string;
  limit?: number;
  offset?: number;
}

export interface CalendarPaging {
  /** Window size actually applied — clamped to [1, MAX_CALENDAR_PAGE_SIZE]. */
  limit: number;
  /** Window start actually applied — clamped to >= 0. */
  offset: number;
  /** Scoped tournaments across every target calendar, before the window. */
  total: number;
  /** How many this response carries. */
  returned: number;
  /** True when `offset + returned < total` — the caller must page again. */
  hasMore: boolean;
}

export interface ScopedCalendar {
  providerAbbr: string;
  provider: any;
  tournaments: any[];
}

/**
 * Clamp caller-supplied paging.
 *
 * Fail-closed (standard A3): anything missing, non-numeric, or out of range
 * lands on the default page size rather than on "no limit". `limit: 0` and a
 * negative limit are caller errors, not requests for everything.
 */
function resolveWindow(params: MyCalendarsParams): { limit: number; offset: number } {
  const requestedLimit = Number(params?.limit);
  const requestedOffset = Number(params?.offset);

  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_CALENDAR_PAGE_SIZE)
    : DEFAULT_CALENDAR_PAGE_SIZE;

  const offset = Number.isFinite(requestedOffset) ? Math.max(Math.trunc(requestedOffset), 0) : 0;

  return { limit, offset };
}

/** Paging block for a response with no target calendars at all. */
export function emptyPaging(params: MyCalendarsParams): CalendarPaging {
  const { limit, offset } = resolveWindow(params);
  return { limit, offset, total: 0, returned: 0, hasMore: false };
}

/**
 * Apply one window across the concatenation of already-scoped calendars.
 *
 * The window runs over the calendars in order, so a caller paging with a stable
 * `providerAbbr`/membership set walks every tournament exactly once. Each
 * calendar is kept in the response even when the window misses it entirely —
 * its `provider` block is how TMX labels the row group, and dropping it would
 * make a provider vanish from the UI on page 2.
 */
export function pageCalendars(
  scoped: ScopedCalendar[],
  params: MyCalendarsParams,
): { calendars: Array<ScopedCalendar & { total: number }>; paging: CalendarPaging } {
  const { limit, offset } = resolveWindow(params);

  const total = scoped.reduce((sum, calendar) => sum + calendar.tournaments.length, 0);
  const windowEnd = offset + limit;

  let cursor = 0;
  let returned = 0;

  const calendars = scoped.map((calendar) => {
    const start = cursor;
    const end = cursor + calendar.tournaments.length;
    cursor = end;

    // Intersect [start, end) with [offset, windowEnd), then translate back into
    // this calendar's own index space.
    const from = Math.max(offset, start) - start;
    const to = Math.min(windowEnd, end) - start;
    const tournaments = from < to ? calendar.tournaments.slice(from, to) : [];
    returned += tournaments.length;

    return { ...calendar, tournaments, total: calendar.tournaments.length };
  });

  return { calendars, paging: { limit, offset, total, returned, hasMore: offset + returned < total } };
}
