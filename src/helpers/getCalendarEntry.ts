import { queryGovernor } from 'tods-competition-factory';

export function getCalendarEntry({ tournamentRecord }) {
  const { tournamentName, tournamentId, startDate, endDate, parentOrganisation } = tournamentRecord;
  const tournamentInfo = queryGovernor.getTournamentInfo({ tournamentRecord })?.tournamentInfo ?? {};
  const providerId = parentOrganisation?.organisationId;
  const tournamentImageURL = tournamentRecord.onlineResources?.find(
    (resource) =>
      resource.resourceType === 'URL' && resource.resourceSubType === 'IMAGE' && resource.name === 'tournamentImage',
  )?.identifier;

  return {
    searchText: tournamentName.toLowerCase(),
    tournamentId,
    providerId,
    tournament: {
      ...tournamentInfo,
      startDate: new Date(startDate).toISOString().split('T')[0],
      endDate: new Date(endDate).toISOString().split('T')[0],
      tournamentImageURL,
      tournamentName,
    },
  };
}
