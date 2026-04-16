import { getCompetitionScheduleMatchUps } from './getCompetitionScheduleMatchUps';
import { getAssistantContext } from './getAssistantContext';
import { getTournamentInfo } from './getTournamentInfo';
import { getParticipants } from './getParticipants';
import { getEventData } from './getEventData';

export const publicQueries = {
  getCompetitionScheduleMatchUps,
  getAssistantContext,
  getTournamentInfo,
  getParticipants,
  getEventData,
};

export default publicQueries;
