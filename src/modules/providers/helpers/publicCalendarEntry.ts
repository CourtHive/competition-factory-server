/**
 * Public projection for `POST /provider/calendar` (`@Public()`, unauthenticated).
 *
 * ## What changed with migration 047
 *
 * The stored entry used to be `getTournamentInfo`'s whole projection in one JSONB blob, so
 * this file was an **allow-list guarding against an upstream shape that grows** — and it
 * existed because that shape had already leaked staff contacts, venue addresses and creator
 * UUIDs to anyone who could guess a provider abbreviation (found 2026-08-29).
 *
 * `calendar_tournaments` classifies every column PUBLIC or PRIVATE, so the projection is now
 * a **column selection**: a field added upstream lands in `remainder` (PRIVATE) and reaches
 * nothing public until someone promotes it to a column and answers the visibility question
 * in doing so. The allow-list below is kept as the second half of a belt-and-braces pair —
 * it costs nothing and it is what fails closed if a future column is misclassified.
 *
 * Publish filtering likewise runs in SQL now (`publishedOnly`). `publicCalendar` still
 * filters, deliberately: a caller who forgets the flag must not leak drafts.
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

/**
 * Event fields safe to serve unauthenticated, for events that are actually published.
 *
 * `notes` is deliberately absent — it is operator-facing on an event exactly as it is on a
 * tournament. `entriesCount` and `drawDefinitionCount` are counts, not draw contents.
 */
const PUBLIC_EVENT_FIELDS = [
  'eventId',
  'eventName',
  'eventType',
  'gender',
  'category',
  'discipline',
  'eventLevel',
  'surfaceCategory',
  'ballType',
  'matchUpFormat',
  'matchUpFormats',
  'competitionFormat',
  'startDate',
  'endDate',
  'entriesCount',
  'drawDefinitionCount',
  'onlineResources',
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

/**
 * The events an anonymous caller may see.
 *
 * **The stored entry carries every event, published or not.**
 * `getTournamentCalendarEntry` calls `getTournamentInfo` WITHOUT `usePublishState`, so the
 * guard `if (!usePublishState || publishedEventIds.includes(...))` short-circuits true and
 * all events are written. Before 047 that never reached anyone, because `eventInfo` was
 * simply absent from the allow-list above — held back by omission rather than by a decision.
 *
 * No per-event flag is stamped, and none is needed:
 * `publishState.status.publishedEventIds` rides along in the same row, written in the same
 * operation, so it cannot go stale against the events beside it.
 *
 * ## Why there is no embargo clause here
 *
 * Embargoes are recorded at DRAW and STAGE level (`collectEventEmbargoes` →
 * `collectDrawEmbargoes`), plus `orderOfPlay` / `participants` at tournament level. There is
 * no event-level embargo to test, and nothing in `PUBLIC_EVENT_FIELDS` carries draw
 * contents — only counts. So publish intent is the whole gate for listing an event.
 *
 * If an embargo check is ever added here, it must re-evaluate the `embargo` TIMESTAMP
 * against now. The stored `embargoActive` boolean is computed at write time by `isEmbargoed`
 * (`new Date(embargo) > Date.now()`) and is therefore stale the moment the embargo lapses —
 * the "never a stale stored boolean" rule `courthive-query` states for the same reason.
 */
function publicEventInfo(entry: any): any[] | undefined {
  const eventInfo = entry?.tournament?.eventInfo;
  if (!Array.isArray(eventInfo)) return undefined;

  // Fail closed: no publishedEventIds means nothing is known to be published.
  const publishedEventIds: string[] = entry?.tournament?.publishState?.status?.publishedEventIds ?? [];

  return eventInfo
    .filter((event: any) => event?.eventId && publishedEventIds.includes(event.eventId))
    .map((event: any) => pick(event, PUBLIC_EVENT_FIELDS));
}

/** Project one stored calendar entry down to its public shape. */
export function publicCalendarEntry(entry: any): any {
  const tournament = pick(entry?.tournament, PUBLIC_TOURNAMENT_FIELDS);
  const eventInfo = publicEventInfo(entry);
  if (eventInfo) tournament.eventInfo = eventInfo;

  return { ...pick(entry, PUBLIC_ENTRY_FIELDS), tournament };
}

/**
 * Is this entry publicly listable?
 *
 * **Strict equality, so a missing flag withholds.** The alternative — treat absent as
 * published — is fail-open, and is the shape that produced this endpoint's original defect.
 */
function isPubliclyListable(entry: any): boolean {
  return entry?.published === true;
}

/**
 * Project a whole stored calendar to its public shape.
 *
 * Three independent reductions, all of which matter:
 *  - **which tournaments** — published only (belt-and-braces with the SQL filter);
 *  - **which events** — published only, within each listed tournament;
 *  - **which fields** — the allow-lists above.
 *
 * `provider` is reduced to public identity. Since 047 it is read from the `providers` table
 * rather than from a copy stored beside the calendar, so it is no longer a snapshot that
 * silently drifts until the next tournament save.
 *
 * ⚠ NOT filtered here: sanctioning approval. A tournament that has not completed a
 * sanctioning process should also be withheld from the public list, but no sanctioning state
 * is readable from the tournament record today. Confirmed with CA 2026-08-30: a capability
 * to build toward, not a filter that can be written now.
 */
export function publicCalendar(calendar: any): any {
  return {
    provider: pick(calendar?.provider, ['organisationId', 'organisationName', 'organisationAbbreviation']),
    tournaments: (calendar?.tournaments ?? []).filter(isPubliclyListable).map(publicCalendarEntry),
  };
}
