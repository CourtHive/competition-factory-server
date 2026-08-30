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
 * Project a whole stored calendar to its public shape.
 *
 * `provider` is reduced to public identity only — the stored object is the full
 * provider record, which carries settings and internal configuration.
 */
export function publicCalendar(calendar: any): any {
  return {
    provider: pick(calendar?.provider, ['organisationId', 'organisationName', 'organisationAbbreviation']),
    tournaments: (calendar?.tournaments ?? []).map(publicCalendarEntry),
  };
}
