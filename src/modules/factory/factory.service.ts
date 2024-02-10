import { queryTournamentRecords } from './functions/private/queryTournamentRecords';
import { executionQueue as eq } from './functions/private/executionQueue';
import { setMatchUpStatus } from './functions/private/setMatchUpStatus';
import { checkEngineError } from '../../common/errors/engineError';
import { getMatchUps } from './functions/private/getMatchUps';
import { askEngine } from 'tods-competition-factory';
import fileStorage from 'src/services/fileSystem';
import levelStorage from 'src/services/levelDB';
import publicQueries from './functions/public';
import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';

@Injectable()
export class FactoryService {
  constructor(private readonly configService: ConfigService) {}

  getStorage() {
    const storage = this.configService.get('APP').storage;
    return storage === 'levelDB' ? levelStorage : fileStorage;
  }

  getVersion(): any {
    const version = askEngine.version();
    return { version };
  }

  async executionQueue(params) {
    const result = await eq(params, { storage: this.getStorage() });
    checkEngineError(result);
    return result;
  }

  async setMatchUpStatus(params, cacheManager) {
    return await setMatchUpStatus(params, { cacheManager, storage: this.getStorage() });
  }

  async getMatchUps(params) {
    return await getMatchUps(params);
  }

  async fetchTournamentRecords(params) {
    return await this.getStorage().fetchTournamentRecords(params);
  }

  async generateTournamentRecord(params) {
    return this.getStorage().generateTournamentRecord(params);
  }

  async queryTournamentRecords(params) {
    return await queryTournamentRecords(params, { storage: this.getStorage() });
  }

  async removeTournamentRecords(params) {
    return await this.getStorage().removeTournamentRecords(params);
  }

  async saveTournamentRecords(params) {
    return await this.getStorage().saveTournamentRecords(params);
  }

  async getTournamentInfo({ tournamentId }: { tournamentId: string }) {
    return await publicQueries.getTournamentInfo({ tournamentId }, { storage: this.getStorage() });
  }

  async getEventData({ tournamentId, eventId }: { tournamentId: string; eventId: string }) {
    return await publicQueries.getEventData({ tournamentId, eventId }, { storage: this.getStorage() });
  }
}
