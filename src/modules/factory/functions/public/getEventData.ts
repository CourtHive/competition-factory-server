import levelStorage from 'src/services/levelDB';
import { queryGovernor } from 'tods-competition-factory';

export async function getEventData(params: any) {
  if (!params.tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };
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
