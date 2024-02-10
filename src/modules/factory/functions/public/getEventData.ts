import { queryGovernor } from 'tods-competition-factory';

export async function getEventData(params: any, services?: any) {
  const findResult = await services.storage.findTournamentRecord({ tournamentId: params.tournamentId });
  if (findResult.error) return findResult;
  const infoResult = queryGovernor.getEventData({
    tournamentRecord: findResult.tournamentRecord,
    eventId: params.eventId,
    usePublishState: true,
  });
  if (infoResult.error) return infoResult;
  return infoResult.eventData;
}
