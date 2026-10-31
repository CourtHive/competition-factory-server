import { queryGovernor, Tournament } from 'tods-competition-factory';

import type { ITournamentStorage } from 'src/storage/interfaces';
import { SUCCESS } from 'src/common/constants/app';

export type AssistantContext = {
  tournament: { tournamentName?: string; startDate?: string; endDate?: string; status?: string };
  events: { eventName?: string; eventType?: string; category?: string; drawsCount: number; entriesCount: number }[];
  venues: { venueName?: string; courtsCount: number }[];
  scheduleStatus?: {
    totalMatchUps: number;
    scheduledMatchUps: number;
    completedMatchUps: number;
    percentComplete: number;
  };
};

/** named for the declaration emit (TS2883 under published resolution), as `EventDataResult` */
export type AssistantContextResult =
  | { error: string }
  | Awaited<ReturnType<ITournamentStorage['findTournamentRecord']>>
  | ReturnType<typeof queryGovernor.getTournamentInfo>
  | (typeof SUCCESS & { assistantContext: AssistantContext });

export async function getAssistantContext(
  { tournamentId }: { tournamentId: string },
  storage: ITournamentStorage,
): Promise<AssistantContextResult> {
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };
  const findResult = await storage.findTournamentRecord({ tournamentId });
  if (findResult.error) return findResult;

  const tournamentRecord = findResult.tournamentRecord as Tournament;

  const infoResult = queryGovernor.getTournamentInfo({
    tournamentRecord,
    withMatchUpStats: true,
    withVenueData: true,
  });
  const info = infoResult.tournamentInfo;
  if (infoResult.error || !info) return infoResult;

  // the fields getTournamentInfo returns: events on `eventInfo`, counts on `matchUpStats` (`withMatchUpStats`); a
  // tournament carries no category of its own, an event does
  const tournament = {
    tournamentName: info.tournamentName,
    startDate: info.startDate,
    endDate: info.endDate,
    status: info.tournamentStatus,
  };

  const events = (info.eventInfo ?? []).map((event) => ({
    eventName: event.eventName,
    eventType: event.eventType,
    category: event.category?.categoryName,
    drawsCount: event.drawDefinitionCount ?? 0,
    entriesCount: event.entriesCount,
  }));

  const venues = (info.venues ?? []).map((venue) => ({
    venueName: venue.venueName,
    courtsCount: venue.courts?.length ?? 0,
  }));

  const stats = info.matchUpStats;
  const scheduleStatus = stats
    ? {
        totalMatchUps: stats.total,
        scheduledMatchUps: stats.scheduled,
        completedMatchUps: stats.completed,
        percentComplete: stats.percentComplete,
      }
    : undefined;

  return {
    ...SUCCESS,
    assistantContext: { tournament, events, venues, scheduleStatus },
  };
}
