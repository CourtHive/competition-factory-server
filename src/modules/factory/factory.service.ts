import { queryTournamentRecords } from './functions/private/queryTournamentRecords';
import { allTournamentMatchUps } from './functions/private/allTournamentMatchUps';
import { executionQueue as eq } from './functions/private/executionQueue';
import { getTournamentRecords } from 'src/helpers/getTournamentRecords';
import { setMatchUpStatus } from './functions/private/setMatchUpStatus';
import { checkEngineError } from '../../common/errors/engineError';
import { checkProvider } from './helpers/checkProvider';
import { askEngine } from 'tods-competition-factory';
import { checkUser } from './helpers/checkUser';
import publicQueries from './functions/public';
import { Inject, Injectable } from '@nestjs/common';

import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { TOURNAMENT_STORAGE, type ITournamentStorage } from 'src/storage/interfaces';
import { generateTournamentRecord as gen } from './helpers/generateTournamentRecord';

@Injectable()
export class FactoryService {
  constructor(
    private readonly tournamentStorageService: TournamentStorageService,
    @Inject(TOURNAMENT_STORAGE) private readonly tournamentStorage: ITournamentStorage,
  ) {}

  getVersion(): any {
    const version = askEngine.version();
    return { version };
  }

  async executionQueue(params, services) {
    const result = await eq(params, services, this.tournamentStorageService);
    checkEngineError(result);
    return result;
  }

  async score(params, cacheManager) {
    return await setMatchUpStatus(params, { cacheManager }, this.tournamentStorageService);
  }

  async getMatchUps(params) {
    return await allTournamentMatchUps(params, this.tournamentStorage);
  }

  async fetchTournamentRecords(params, user) {
    const validUser = checkUser({ user }); // don't attempt fetch if user is not allowed
    if (!validUser) return { error: 'Invalid user' };
    const result: any = await this.tournamentStorageService.fetchTournamentRecords(params);
    if (result.error) return result;
    const allowUser = checkProvider({ ...result, user });
    return allowUser ? result : { error: 'User not allowed' };
  }

  async generateTournamentRecord(params, user) {
    const { tournamentRecord, tournamentRecords } = await gen(params, user);
    this.tournamentStorageService.saveTournamentRecords({ tournamentRecords });
    return { tournamentRecord, success: true };
  }

  async queryTournamentRecords(params) {
    return await queryTournamentRecords(params, this.tournamentStorage);
  }

  async removeTournamentRecords(params, user) {
    return await this.tournamentStorageService.removeTournamentRecords(params, user);
  }

  async saveTournamentRecords(params, user) {
    const validUser = checkUser({ user }); // don't attempt save if user doesn't have providerId
    if (!validUser) return { error: 'Invalid user' };
    const tournamentRecords = getTournamentRecords(params);
    const allowUser = checkProvider({ tournamentRecords, user });
    if (!allowUser) return { error: 'User not allowed' };
    return await this.tournamentStorageService.saveTournamentRecords(params);
  }

  async getTournamentInfo({ tournamentId }: { tournamentId: string }) {
    return await publicQueries.getTournamentInfo({ tournamentId }, this.tournamentStorage);
  }

  async getEventData({
    hydrateParticipants,
    tournamentId,
    eventId,
  }: {
    hydrateParticipants?: boolean;
    tournamentId: string;
    eventId: string;
  }) {
    return await publicQueries.getEventData({ hydrateParticipants, tournamentId, eventId }, this.tournamentStorage);
  }

  async getScheduleMatchUps({ params }) {
    return await publicQueries.getCompetitionScheduleMatchUps(params, this.tournamentStorage);
  }

  async getParticipants({ params }) {
    return await publicQueries.getParticipants(params, this.tournamentStorage);
  }
}
