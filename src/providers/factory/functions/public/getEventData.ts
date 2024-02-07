import { queryGovernor } from 'tods-competition-factory';
import recordStorage from 'src/data/fileSystem';

export async function getEventData(params: any) {
  const findResult = await recordStorage.findTournamentRecord({ tournamentId: params.tournamentId });
  if (findResult.error) return findResult;
  const infoResult = queryGovernor.getEventData({
    tournamentRecord: findResult.tournamentRecord,
    eventId: params.eventId,
    usePublishState: true,
  });
  if (infoResult.error) return infoResult;
  return infoResult.eventData;
}
