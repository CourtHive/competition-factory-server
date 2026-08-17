import { getCompetitionScheduleMatchUps } from './getCompetitionScheduleMatchUps';
import { getAssistantContext } from './getAssistantContext';
import { getTournamentInfo } from './getTournamentInfo';
import { getParticipants } from './getParticipants';
import { getStructureData } from './getStructureData';
import { getEventData } from './getEventData';
import { getDrawData } from './getDrawData';

export const publicQueries = {
  getCompetitionScheduleMatchUps,
  getAssistantContext,
  getTournamentInfo,
  getParticipants,
  getStructureData,
  getEventData,
  getDrawData,
};

export default publicQueries;
