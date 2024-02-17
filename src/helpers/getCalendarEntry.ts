export function getCalendarEntry({ tournamentRecord }) {
  const { tournamentName, tournamentId, startDate, endDate, parentOrganisation } = tournamentRecord;
  const providerId = parentOrganisation?.organisationId;
  const tournamentImageURL = tournamentRecord.onlineResources.find(
    (resource) =>
      resource.resourceType === 'URL' && resource.resourceSubType === 'IMAGE' && resource.name === 'tournamentImage',
  )?.identifier;

  // TODO: getTournamentInfo with publishState and add events to calendar
  // what other details?  Ratings ranges, age groups, # of matches etc.
  return {
    searchText: tournamentName.toLowerCase(),
    tournamentId,
    providerId,
    tournament: {
      startDate: new Date(startDate).toISOString().split('T')[0],
      endDate: new Date(endDate).toISOString().split('T')[0],
      tournamentImageURL,
      tournamentName,
    },
  };
}
