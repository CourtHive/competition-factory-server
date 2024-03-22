import { GetScheduledMatchUpsDto } from './dto/getCompetitionScheduleMatchUps.dto';
import { RemoveTournamentRecordsDto } from './dto/removeTournamentRecords.dto';
import { FetchTournamentRecordsDto } from './dto/fetchTournamentRecords.dto';
import { QueryTournamentRecordsDto } from './dto/queryTournamentRecords.dto';
import { SaveTournamentRecordsDto } from './dto/saveTournamentRecords.dto';
import { GetTournamentInfoDto } from './dto/getTournamentInfo.dto';
import { SetMatchUpStatusDto } from './dto/setMatchUpStatus.dto';
import { ExecutionQueueDto } from './dto/executionQueue.dto';
import { GetEventDataDto } from './dto/getEventData.dto';
import { GetMatchUpsDto } from './dto/getMatchUps.dto';

import { Controller, Get, Post, HttpCode, HttpStatus, Body, UseGuards, Inject, Param, Logger } from '@nestjs/common';
import { CLIENT, GENERATE, SCORE, SUPER_ADMIN } from 'src/common/constants/roles';
import { Public } from 'src/modules/auth/decorators/public.decorator';
import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/modules/auth/guards/role.guard';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { User } from '../auth/decorators/user.decorator';
import { FactoryService } from './factory.service';

@UseGuards(RolesGuard)
@Controller('factory')
export class FactoryController {
  constructor(
    private readonly factoryService: FactoryService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async cacheFx(key, fx, params) {
    const cachedData: any = await this.cacheManager.get(key);
    if (cachedData) {
      if (typeof cachedData === 'object') cachedData._cached = true;
      Logger.verbose(`Cache hit: ${key}`);
      return cachedData;
    }
    const result = await fx(params);
    if (!result.error) this.cacheManager.set(key, result, 60 * 3 * 1000); // 3 minutes
    return result;
  }

  @Get()
  @Public()
  default() {
    return { message: 'Factory services' };
  }

  @Public()
  @Get('version')
  getVersion(): { version: string } {
    return this.factoryService.getVersion();
  }

  @Public()
  @Get('tournamentinfo/:tid')
  async getTournamentInfo(@Param('tid') tid) {
    const key = `gti|${tid}`;
    return await this.cacheFx(key, this.factoryService.getTournamentInfo, { tournamentId: tid });
  }

  @Public()
  @Post('tournamentinfo')
  async tournamentInfo(@Body() gti: GetTournamentInfoDto) {
    const key = `gti|${gti.tournamentId}`;
    return await this.cacheFx(key, this.factoryService.getTournamentInfo, gti);
  }

  @Public()
  @Post('eventdata')
  async eventData(@Body() ged: GetEventDataDto) {
    const key = `ged|${ged.tournamentId}|${ged.eventId}`;
    return await this.cacheFx(key, this.factoryService.getEventData, ged);
  }

  @Post('scheduledmatchups')
  @Roles([SCORE, SUPER_ADMIN])
  async tournamentMatchUps(@Body() gtm: GetScheduledMatchUpsDto) {
    const key = `gtm|${gtm.params?.tournamentId}`;
    return await this.cacheFx(key, this.factoryService.getScheduleMatchUps, gtm);
  }

  @Post('matchups')
  @Roles([SCORE, SUPER_ADMIN])
  async getMatchUps(@Body() gmr: GetMatchUpsDto) {
    const key = `gmr|${gmr.tournamentId}`;
    return await this.cacheFx(key, this.factoryService.getMatchUps, gmr);
  }

  @Post('score')
  @Roles([SCORE, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async scoreMatchUp(@Body() sms: SetMatchUpStatusDto) {
    console.log({ sms });
    return await this.factoryService.score(sms, this.cacheManager);
  }

  @Post()
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  executionQueue(@Body() eqd: ExecutionQueueDto) {
    return this.factoryService.executionQueue(eqd, { cacheManager: this.cacheManager });
  }

  @Post('fetch')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  fetchTournamentRecords(@Body() ftd: FetchTournamentRecordsDto, @User() user?: any) {
    return this.factoryService.fetchTournamentRecords(ftd, user);
  }

  @Post('generate')
  @Roles([SUPER_ADMIN, GENERATE])
  @HttpCode(HttpStatus.OK)
  generateTournamentRecord(@Body() gtd: any, @User() user?: any) {
    return this.factoryService.generateTournamentRecord(gtd, user);
  }

  @Post('query')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  queryTournamentRecords(@Body() qtd: QueryTournamentRecordsDto) {
    return this.factoryService.queryTournamentRecords(qtd);
  }

  @Post('remove')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  removeTournamentRecords(@Body() rtd: RemoveTournamentRecordsDto, @User() user?: any) {
    return this.factoryService.removeTournamentRecords(rtd, user);
  }

  @Post('save')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  saveTournamentRecords(@Body() std: SaveTournamentRecordsDto, @User() user?: any) {
    return this.factoryService.saveTournamentRecords(std, user);
  }
}
