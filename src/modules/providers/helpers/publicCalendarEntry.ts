/**
 * Public projection for `POST /provider/calendar` (`@Public()`, unauthenticated).
 *
 * The stored calendar entry is NOT a public shape. It is written on every
 * `saveTournamentRecord` (`tournament-storage.service.ts` → `addToOrUpdateCalendar`,
 * with no publish gating at all), and it is built by `getCalendarEntry()` =
 * factory `getTournamentCalendarEntry()` **plus `createdByUserId`** — a user UUID
 * added for the *authenticated* `my-calendars` ownership filter. The factory half
 * spreads the whole `getTournamentInfo` projection, which attaches
 * `tournamentContacts` (staff contact details), `tournamentAddress`, `venues`,
 * `notes` and `registrationProfile`.
 *
 * Serving that verbatim to an unauthenticated caller leaked staff contacts, venue
 * addresses and creator UUIDs to anyone who could guess a provider abbreviation
 * (found 2026-08-29).
 *
 * This is an **allow-list**, deliberately. A deny-list would re-leak the next field
 * anyone adds upstream — and the upstream shape is `getTournamentInfo`, which grows.
 * The fields below are the measured consumer contract: `courthive-public` is the only
 * consumer (`tournamentsApi.ts` → `/provider/calendar`) and `TournamentList.svelte`
 * reads `tournamentId`, `tournament.tournamentName`, `tournament.startDate`,
 * `tournament.tournamentImageURL` and `tournament.onlineResources`. `searchText`,
 * `providerId`, `endDate` and the identity/tier fields are included because they are
 * inherent to a public tournament listing and carry nothing private.
 *
 * ⚠️ NOT solved here: unpublished tournaments are still listed. The stored entry
 * carries no publish signal (`extractTournamentInfo` projects no `publishState`), so
 * filtering needs a write-path change plus a backfill — failing closed on entries that
 * lack the flag would empty every live provider calendar. Tracked separately.
 */

/** Tournament fields safe to serve unauthenticated. */
const PUBLIC_TOURNAMENT_FIELDS = [
  'tournamentId',
  'tournamentName',
  'promotionalName',
  'formalName',
  'tournamentImageURL',
  'onlineResources',
  'startDate',
  'endDate',
  'activeDates',
  'localTimeZone',
  'hostCountryCode',
  'tournamentStatus',
  'tournamentRank',
  'tournamentTier',
] as const;

/** Top-level entry fields safe to serve unauthenticated. */
const PUBLIC_ENTRY_FIELDS = ['tournamentId', 'providerId', 'searchText'] as const;

function pick(source: any, keys: readonly string[]): any {
  if (!source || typeof source !== 'object') return {};
  const out: any = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/** Project one stored calendar entry down to its public shape. */
export function publicCalendarEntry(entry: any): any {
  return {
    ...pick(entry, PUBLIC_ENTRY_FIELDS),
    tournament: pick(entry?.tournament, PUBLIC_TOURNAMENT_FIELDS),
  };
}

/**
 * Is this entry publicly listable?
 *
 * `published` is stamped at write time by `getCalendarEntry()`. **Strict equality, so a
 * missing flag withholds** — an entry written before the flag existed is not published
 * as far as this endpoint is concerned. That is deliberate: the alternative (treat
 * absent as published) is fail-open, and it is the shape that produced this endpoint's
 * original defect.
 *
 * The cost of that choice is real and must be paid at deploy: every calendar written
 * before this change lists nothing publicly until it is re-stamped. Run
 * `scripts/backfill-calendar-published.mjs` as part of the rollout — entries also
 * self-heal on the tournament's next save, but that is not a schedule anyone controls.
 */
function isPubliclyListable(entry: any): boolean {
  return entry?.published === true;
}

/**
 * Project a whole stored calendar to its public shape.
 *
 * Two independent reductions, and both matter:
 *  - **which tournaments** — published only (unpublished and draft tournaments were
 *    listed to anonymous callers, because the calendar is written on every save);
 *  - **which fields** — the allow-list above.
 *
 * `provider` is reduced to public identity only; the stored object is the full provider
 * record, which carries settings and internal configuration.
 *
 * ⚠️ NOT filtered here: sanctioning approval. A tournament that has not completed a
 * sanctioning process should also be withheld from the public list, but no sanctioning
 * state is readable from the tournament record today — `getTournamentInfo` has no
 * awareness of it. Confirmed with CA 2026-08-30: that is a capability to build toward,
 * not a filter that can be written now.
 */
export function publicCalendar(calendar: any): any {
  return {
    provider: pick(calendar?.provider, ['organisationId', 'organisationName', 'organisationAbbreviation']),
    tournaments: (calendar?.tournaments ?? []).filter(isPubliclyListable).map(publicCalendarEntry),
  };
}
