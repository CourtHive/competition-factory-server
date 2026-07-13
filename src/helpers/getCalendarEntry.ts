import { CREATED_BY_USER_ID } from 'src/modules/factory/helpers/checkTournamentAccess';
import { queryGovernor } from 'tods-competition-factory';

export function getCalendarEntry({ tournamentRecord }) {
  // The lightweight calendar-list entry shape is derived by the factory
  // (queryGovernor.getTournamentCalendarEntry) so the server and any client
  // produce an identical entry. Here we add only the server-specific ownership
  // projection: the creator's UUID, so the authenticated /provider/my-calendars
  // endpoint can filter by ownership without loading full tournament records.
  const entry = queryGovernor.getTournamentCalendarEntry({ tournamentRecord });
  const createdByUserId = (tournamentRecord.extensions ?? []).find((ext) => ext?.name === CREATED_BY_USER_ID)?.value;

  return { ...entry, createdByUserId };
}
