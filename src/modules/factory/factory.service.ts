import { queryTournamentRecords } from './functions/private/queryTournamentRecords';
import { executionQueue as eq } from './functions/private/executionQueue';
import { allTournamentMatchUps } from './functions/private/allTournamentMatchUps';
import { getTournamentRecords } from 'src/helpers/getTournamentRecords';
import { setMatchUpStatus } from './functions/private/setMatchUpStatus';
import { checkEngineError } from '../../common/errors/engineError';
import { checkProvider } from './helpers/checkProvider';
import { askEngine } from 'tods-competition-factory';
import { checkUser } from './helpers/checkUser';
import levelStorage from 'src/services/levelDB';
import publicQueries from './functions/public';
import { Injectable } from '@nestjs/common';

@Injectable()
export class FactoryService {
  getVersion(): any {
    const version = askEngine.version();
    return { version };
  }

  async executionQueue(params, services) {
    const result = await eq(params, services);
    checkEngineError(result);
    return result;
  }

  async score(params, cacheManager) {
    return await setMatchUpStatus(params, { cacheManager });
  }

  async getMatchUps(params) {
    return await allTournamentMatchUps(params);
  }

  async fetchTournamentRecords(params, user) {
    const validUser = checkUser({ user }); // don't attempt fetch if user is not allowed
    if (!validUser) return { error: 'Invalid user' };
    const result: any = await levelStorage.fetchTournamentRecords(params);
    if (result.error) return result;
    const allowUser = checkProvider({ ...result, user });
    return allowUser ? result : { error: 'User not allowed' };
  }

  async generateTournamentRecord(params, user) {
    return levelStorage.generateTournamentRecord(params, user);
  }

  async queryTournamentRecords(params) {
    return await queryTournamentRecords(params);
  }

  async removeTournamentRecords(params, user) {
    return await levelStorage.removeTournamentRecords(params, user);
  }

  async saveTournamentRecords(params, user) {
    const validUser = checkUser({ user }); // don't attempt save if user doesn't have providerId
    if (!validUser) return { error: 'Invalid user' };
    const tournamentRecords = getTournamentRecords(params);
    const allowUser = checkProvider({ tournamentRecords, user });
    if (!allowUser) return { error: 'User not allowed' };
    return await levelStorage.saveTournamentRecords(params);
  }

  async getTournamentInfo({ tournamentId }: { tournamentId: string }) {
    return await publicQueries.getTournamentInfo({ tournamentId });
  }

  async getEventData({ tournamentId, eventId }: { tournamentId: string; eventId: string }) {
    return await publicQueries.getEventData({ tournamentId, eventId });
  }

  async getScheduleMatchUps({ params }) {
    return await publicQueries.getCompetitionScheduleMatchUps(params);
  }
}
