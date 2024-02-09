import { queryTournamentRecords } from './functions/private/queryTournamentRecords';
import { executionQueue as eq } from './functions/private/executionQueue';
import { setMatchUpStatus } from './functions/private/setMatchUpStatus';
import { checkEngineError } from '../../common/errors/engineError';
import { getMatchUps } from './functions/private/getMatchUps';
import { recordStorage } from '../../data/fileSystem';
import { askEngine } from 'tods-competition-factory';
import publicQueries from './functions/public';
import { Injectable } from '@nestjs/common';

@Injectable()
export class FactoryService {
  getVersion(): any {
    const version = askEngine.version();
    return { version };
  }

  async executionQueue(params) {
    const result = await eq(params);
    checkEngineError(result);
    return result;
  }

  async setMatchUpStatus(params, cacheManager) {
    return await setMatchUpStatus(params, cacheManager);
  }

  async getMatchUps(params) {
    return await getMatchUps(params);
  }

  async fetchTournamentRecords(params) {
    return await recordStorage.fetchTournamentRecords(params);
  }

  async generateTournamentRecord(params) {
    return recordStorage.generateTournamentRecord(params);
  }

  async queryTournamentRecords(params) {
    return await queryTournamentRecords(params);
  }

  async removeTournamentRecords(params) {
    return await recordStorage.removeTournamentRecords(params);
  }

  async saveTournamentRecords(params) {
    return await recordStorage.saveTournamentRecords(params);
  }

  async getTournamentInfo({ tournamentId }: { tournamentId: string }) {
    return await publicQueries.getTournamentInfo({ tournamentId });
  }

  async getEventData({ tournamentId, eventId }: { tournamentId: string; eventId: string }) {
    return await publicQueries.getEventData({ tournamentId, eventId });
  }
}
