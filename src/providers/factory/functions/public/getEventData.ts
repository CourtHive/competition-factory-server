import { queryGovernor } from 'tods-competition-factory';
import levelStorage from 'src/services/levelDB';

export async function getEventData(params: any) {
  const findResult = await levelStorage.findTournamentRecord({ tournamentId: params.tournamentId });
  if (findResult.error) return findResult;
  const infoResult = queryGovernor.getEventData({
    tournamentRecord: findResult.tournamentRecord,
    eventId: params.eventId,
    usePublishState: true,
  });
  if (infoResult.error) return infoResult;
  return infoResult.eventData;
}
