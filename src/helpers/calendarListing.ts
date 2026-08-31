/**
 * Whether a provider-owned tournament also belongs in that provider's CALENDAR.
 *
 * Ownership and listing were the same act until now: `saveTournamentRecord` added to the calendar
 * whenever `parentOrganisation` was present. That holds for a tournament, and breaks for a fixture.
 *
 * A college dual is owned by the governing body but belongs to the SEASONS OF TWO PROGRAMMES, and a
 * tournament may live in only one calendar (`detachFromOtherCalendars` enforces it). Listing it
 * would therefore have to pick a side. It also does not scale: a calendar is one row holding its
 * whole entry list in a single JSONB column, read-whole and rewritten on every save, so tens of
 * thousands of fixtures make every read of that calendar pay for all of them.
 *
 * The relation those fixtures actually need is participation, which is its own read model.
 *
 * DEFAULT IS LISTED. Absence of the extension means listed, so every record that exists today keeps
 * its behaviour exactly; only an explicit `false` opts out. A default here would silently empty
 * calendars.
 */
export const CALENDAR_LISTED = 'calendarListed';

export function isCalendarListed(tournamentRecord: any): boolean {
  const extension = (tournamentRecord?.extensions ?? []).find((ext) => ext?.name === CALENDAR_LISTED);
  // Strictly false opts out. Anything else — absent, true, malformed — lists, because withholding a
  // tournament from its own calendar on a misread is the more damaging failure.
  return extension?.value !== false;
}
