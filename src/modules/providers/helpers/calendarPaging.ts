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

/**
 * Clamp caller-supplied paging.
 *
 * Fail-closed (standard A3): anything missing, non-numeric, or out of range lands on the
 * default page size rather than on "no limit". `limit: 0` and a negative limit are caller
 * errors, not requests for everything.
 */
export function resolveWindow(params: MyCalendarsParams | undefined): { limit: number; offset: number } {
  const requestedLimit = Number(params?.limit);
  const requestedOffset = Number(params?.offset);

  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_CALENDAR_PAGE_SIZE)
    : DEFAULT_CALENDAR_PAGE_SIZE;

  const offset = Number.isFinite(requestedOffset) ? Math.max(Math.trunc(requestedOffset), 0) : 0;

  return { limit, offset };
}

/**
 * The `paging` block for a response.
 *
 * `total` is the count BEFORE the window, taken from the same predicate as the page itself,
 * so `hasMore` cannot disagree with what a subsequent request returns.
 */
export function pagingFor({
  total,
  returned,
  limit,
  offset,
}: {
  total: number;
  returned: number;
  limit: number;
  offset: number;
}): CalendarPaging {
  return { limit, offset, total, returned, hasMore: offset + returned < total };
}
