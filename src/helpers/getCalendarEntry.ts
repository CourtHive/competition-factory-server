import { CREATED_BY_USER_ID } from 'src/modules/factory/helpers/checkTournamentAccess';
import { queryGovernor } from 'tods-competition-factory';

export function getCalendarEntry({ tournamentRecord }) {
  const { tournamentName, tournamentId, startDate, endDate, parentOrganisation } = tournamentRecord;
  const tournamentInfo = queryGovernor.getTournamentInfo({ tournamentRecord })?.tournamentInfo ?? {};
  const providerId = parentOrganisation?.organisationId;
  const tournamentImageURL = tournamentRecord.onlineResources?.find(
    (resource) =>
      resource.resourceType === 'URL' && resource.resourceSubType === 'IMAGE' && resource.name === 'tournamentImage',
  )?.identifier;

  // Project the creator's UUID into the calendar entry so the
  // authenticated /provider/my-calendars endpoint can filter by
  // ownership without loading full tournament records.
  const createdByUserId = (tournamentRecord.extensions ?? []).find(
    (ext) => ext?.name === CREATED_BY_USER_ID,
  )?.value;

  return {
    searchText: tournamentName.toLowerCase(),
    tournamentId,
    providerId,
    createdByUserId,
    tournament: {
      ...tournamentInfo,
      startDate: new Date(startDate).toISOString().split('T')[0],
      endDate: new Date(endDate).toISOString().split('T')[0],
      tournamentImageURL,
      tournamentName,
    },
  };
}
