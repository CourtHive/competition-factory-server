import { queryGovernor, Tournament } from 'tods-competition-factory';

import type { ITournamentStorage } from 'src/storage/interfaces';
import { SUCCESS } from 'src/common/constants/app';

export async function getAssistantContext(
  { tournamentId }: { tournamentId: string },
  storage: ITournamentStorage,
) {
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };
  const findResult = await storage.findTournamentRecord({ tournamentId });
  if (findResult.error) return findResult;

  const tournamentRecord = findResult.tournamentRecord as Tournament;

  const infoResult = queryGovernor.getTournamentInfo({
    tournamentRecord,
    withMatchUpStats: true,
    withVenueData: true,
  });
  if (infoResult.error) return infoResult;

  const info = infoResult.tournamentInfo;

  const tournament = {
    tournamentName: info.tournamentName,
    startDate: info.startDate,
    endDate: info.endDate,
    category: info.category?.categoryName,
    status: info.tournamentStatus,
  };

  const events = (info.events ?? []).map((event: any) => ({
    eventName: event.eventName,
    eventType: event.eventType,
    drawSize: event.drawDefinitions?.[0]?.drawSize,
    entriesCount: event.entries?.length,
    matchUpsCount: event.matchUpCounts?.total,
    completedMatchUps: event.matchUpCounts?.completed,
  }));

  const venues = (info.venues ?? []).map((venue: any) => ({
    venueName: venue.venueName,
    courtsCount: venue.courts?.length ?? 0,
  }));

  const scheduleStatus = info.matchUpCounts
    ? {
        totalMatchUps: info.matchUpCounts.total ?? 0,
        scheduledMatchUps: info.matchUpCounts.scheduled ?? 0,
        completedMatchUps: info.matchUpCounts.completed ?? 0,
        inProgressMatchUps: info.matchUpCounts.inProgress ?? 0,
      }
    : undefined;

  return {
    ...SUCCESS,
    assistantContext: { tournament, events, venues, scheduleStatus },
  };
}
