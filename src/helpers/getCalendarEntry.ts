import { CREATED_BY_USER_ID } from 'src/modules/factory/helpers/checkTournamentAccess';
import { queryGovernor } from 'tods-competition-factory';

/**
 * Read the tournament-level publish flag.
 *
 * `publishState.tournament.status.published` is the factory's own roll-up: true when
 * any event is published, or when orderOfPlay/participants are. It is the same signal
 * the public read endpoints gate on via `usePublishState`.
 *
 * Stamped onto the calendar entry at WRITE time on purpose. The public calendar has to
 * filter on it, and deriving it at read time would mean loading every tournament record
 * for the provider on an unauthenticated route — an unbounded cross-tournament query on
 * a public surface, which is exactly what architectural-standard A7 forbids.
 */
function isPublished(tournamentRecord: any): boolean {
  try {
    const { publishState } = queryGovernor.getPublishState({ tournamentRecord }) ?? {};
    return publishState?.tournament?.status?.published === true;
  } catch {
    // A malformed record must not take down a save. Absent/failed → not published,
    // which withholds rather than exposes.
    return false;
  }
}

export function getCalendarEntry({ tournamentRecord }) {
  // The lightweight calendar-list entry shape is derived by the factory
  // (queryGovernor.getTournamentCalendarEntry) so the server and any client
  // produce an identical entry. Here we add only the server-specific projections:
  // the creator's UUID, so the authenticated /provider/my-calendars endpoint can
  // filter by ownership without loading full tournament records; and `published`,
  // so the PUBLIC calendar can exclude unpublished tournaments without doing the same.
  //
  // Neither is a public field. `/provider/calendar` projects the entry through
  // `publicCalendarEntry()` before it leaves the process.
  const entry = queryGovernor.getTournamentCalendarEntry({ tournamentRecord });
  const createdByUserId = (tournamentRecord.extensions ?? []).find((ext) => ext?.name === CREATED_BY_USER_ID)?.value;

  return { ...entry, createdByUserId, published: isPublished(tournamentRecord) };
}
