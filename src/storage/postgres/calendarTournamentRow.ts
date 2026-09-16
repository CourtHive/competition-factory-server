/**
 * The projection between a stored calendar ENTRY and a `calendar_tournaments` ROW.
 *
 * Migration 047 replaced one JSONB blob per provider with one row per tournament. This
 * module is the only place that knows the column layout, and it is deliberately a pair of
 * mutually-inverse functions so the round trip can be tested as a property rather than
 * asserted field by field.
 *
 * **The wire shape does not change.** `toRow`/`fromRow` move an entry between shapes; they
 * never reshape it. Every consumer — TMX, courthive-public, AMS, and the local IndexedDB
 * mirror — keeps receiving `{ tournamentId, providerId, searchText, tournament: {...} }`.
 * That is what lets the 13 behaviour tests from #974 pass unchanged across the cutover.
 */

/** Entry fields promoted to their own column; everything else lands in `remainder`. */
const MAPPED_TOURNAMENT_FIELDS = new Set([
  'tournamentId',
  'tournamentName',
  'startDate',
  'endDate',
  'tournamentStatus',
  'tournamentImageURL',
  'eventInfo',
  'onlineResources',
  'venues',
  'registrationProfile',
  'tournamentContacts',
  'tournamentAddress',
  'publishState',
  'timeItemValues',
  'notes',
  // → identity
  'formalName',
  'promotionalName',
  'tournamentLevel',
  'tournamentRank',
  'tournamentTier',
  'hostCountryCode',
  'localTimeZone',
  'activeDates',
  'updatedAt',
  'parentOrganisation',
]);

/** Public identity fields, carried together in the `identity` column. */
const IDENTITY_FIELDS = [
  'formalName',
  'promotionalName',
  'tournamentLevel',
  'tournamentRank',
  'tournamentTier',
  'hostCountryCode',
  'localTimeZone',
  'activeDates',
  'updatedAt',
  'parentOrganisation',
] as const;

export interface CalendarTournamentRow {
  tournament_id: string;
  provider_id: string;
  provider_abbr: string | null;
  tournament_name: string | null;
  search_text: string;
  start_date: string | null;
  end_date: string | null;
  tournament_status: string | null;
  published: boolean;
  event_count: number | null;
  offline: boolean | null;
  created_by_user_id: string | null;
  tournament_image_url: string | null;
  identity: any;
  online_resources: any;
  event_info: any;
  venues: any;
  registration_profile: any;
  tournament_contacts: any;
  tournament_address: any;
  publish_state: any;
  time_items: any;
  notes: string | null;
  remainder: any;
}

function pick(source: any, keys: readonly string[]): any {
  const out: any = {};
  for (const key of keys) if (source?.[key] !== undefined) out[key] = source[key];
  return out;
}

/**
 * Absent → SQL NULL. An EMPTY object is preserved as `{}`.
 *
 * Collapsing `{}` to NULL was the first implementation, and the real-factory round-trip
 * test caught it: a live entry carries `timeItemValues: {}`, which came back absent. No
 * consumer behaves differently (`timeItemValues?.TMX?.offline` reads the same either way),
 * but the claim this cutover rests on is that the wire shape does not change — and a
 * marginal storage saving is not worth weakening it to "does not change in ways we think
 * matter".
 */
function jsonbOrNull(value: any): any {
  return value === undefined ? null : value;
}

/**
 * Calendar-day normalisation for a DATE column.
 *
 * The entry already carries date-only ISO strings (the factory's `dateOnly`), but a record
 * that predates that, or one hand-written, can carry a full timestamp. Truncating here
 * keeps the column a calendar day rather than an instant — the distinction the Temporal
 * migration turns on, and the reason this does not go through `new Date()`.
 */
function dateOnly(value: any): string | null {
  if (typeof value !== 'string' || !value) return null;
  const [datePart] = value.split('T');
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;
}

/** One stored calendar entry → one `calendar_tournaments` row. */
export function toRow(entry: any, providerId: string, providerAbbr?: string): CalendarTournamentRow {
  const tournament = entry?.tournament ?? {};

  const remainder: any = {};
  for (const key of Object.keys(tournament)) {
    if (!MAPPED_TOURNAMENT_FIELDS.has(key) && tournament[key] !== undefined) {
      remainder[key] = tournament[key];
    }
  }

  return {
    tournament_id: entry?.tournamentId ?? tournament.tournamentId,
    provider_id: providerId,
    provider_abbr: providerAbbr ?? null,
    tournament_name: tournament.tournamentName ?? null,
    search_text: entry?.searchText ?? (tournament.tournamentName ?? '').toLowerCase(),
    start_date: dateOnly(tournament.startDate),
    end_date: dateOnly(tournament.endDate),
    tournament_status: tournament.tournamentStatus ?? null,
    published: entry?.published === true,
    // Counted at write so the list never has to open `event_info` to show a count.
    event_count: Array.isArray(tournament.eventInfo) ? tournament.eventInfo.length : null,
    offline: tournament.timeItemValues?.TMX?.offline ?? null,
    created_by_user_id: entry?.createdByUserId ?? null,
    tournament_image_url: tournament.tournamentImageURL ?? null,
    identity: jsonbOrNull(pick(tournament, IDENTITY_FIELDS)),
    online_resources: jsonbOrNull(tournament.onlineResources),
    event_info: jsonbOrNull(tournament.eventInfo),
    venues: jsonbOrNull(tournament.venues),
    registration_profile: jsonbOrNull(tournament.registrationProfile),
    tournament_contacts: jsonbOrNull(tournament.tournamentContacts),
    tournament_address: jsonbOrNull(tournament.tournamentAddress),
    publish_state: jsonbOrNull(tournament.publishState),
    time_items: jsonbOrNull(tournament.timeItemValues),
    notes: tournament.notes ?? null,
    remainder: jsonbOrNull(remainder),
  };
}

/** Assign only defined values, so a NULL column does not materialise an explicit key. */
function assignDefined(target: any, source: Record<string, any>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value !== null && value !== undefined) target[key] = value;
  }
}

/**
 * One `calendar_tournaments` row → the stored calendar entry shape.
 *
 * The inverse of {@link toRow}, with one deliberate asymmetry: `providerId` is taken from
 * the ROW rather than from whatever the entry once held. The row's `provider_id` is the
 * tenant key the caller resolved, so this repairs a legacy blob entry that carried none —
 * and makes a stale copy impossible rather than merely unlikely.
 *
 * `remainder` is spread FIRST so an explicitly mapped column always wins over a stale copy
 * that an older write may have left in the catch-all.
 */
export function fromRow(row: CalendarTournamentRow): any {
  const tournament: any = { ...(row.remainder ?? {}), ...(row.identity ?? {}) };

  assignDefined(tournament, {
    tournamentId: row.tournament_id,
    tournamentName: row.tournament_name,
    startDate: row.start_date,
    endDate: row.end_date,
    tournamentStatus: row.tournament_status,
    tournamentImageURL: row.tournament_image_url,
    onlineResources: row.online_resources,
    eventInfo: row.event_info,
    venues: row.venues,
    registrationProfile: row.registration_profile,
    tournamentContacts: row.tournament_contacts,
    tournamentAddress: row.tournament_address,
    publishState: row.publish_state,
    timeItemValues: row.time_items,
    notes: row.notes,
  });

  const entry: any = { tournamentId: row.tournament_id, searchText: row.search_text, tournament };
  assignDefined(entry, { providerId: row.provider_id, createdByUserId: row.created_by_user_id });
  // `published` is a boolean the public filter tests with STRICT equality, so it is always
  // present rather than assigned-if-defined — an absent flag must read as not-published.
  entry.published = row.published === true;
  return entry;
}

/** Column order shared by the INSERT and every SELECT, so the two cannot drift. */
export const CALENDAR_TOURNAMENT_COLUMNS = [
  'tournament_id',
  'provider_id',
  'provider_abbr',
  'tournament_name',
  'search_text',
  'start_date',
  'end_date',
  'tournament_status',
  'published',
  'event_count',
  'offline',
  'created_by_user_id',
  'tournament_image_url',
  'identity',
  'online_resources',
  'event_info',
  'venues',
  'registration_profile',
  'tournament_contacts',
  'tournament_address',
  'publish_state',
  'time_items',
  'notes',
  'remainder',
] as const;
