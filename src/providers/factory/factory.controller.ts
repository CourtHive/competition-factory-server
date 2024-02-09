import { RemoveTournamentRecordsDto } from './dto/removeTournamentRecords.dto';
import { FetchTournamentRecordsDto } from './dto/fetchTournamentRecords.dto';
import { QueryTournamentRecordsDto } from './dto/queryTournamentRecords.dto';
import { SaveTournamentRecordsDto } from './dto/saveTournamentRecords.dto';
import { GetTournamentInfoDto } from './dto/getTournamentInfo.dto';
import { ExecutionQueueDto } from './dto/executionQueue.dto';

import { Controller, Get, Post, HttpCode, HttpStatus, Body, UseGuards, Param } from '@nestjs/common';
import { Public } from 'src/auth/decorators/public.decorator';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/auth/guards/role.guard';
import { FactoryService } from './factory.service';
import { GetEventDataDto } from './dto/getEventData.dto';

@UseGuards(RolesGuard)
@Controller('factory')
export class FactoryController {
  constructor(private readonly factoryService: FactoryService) {}

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
  getTournamentInfo(@Param('tid') tid) {
    return this.factoryService.getTournamentInfo({ tournamentId: tid });
  }

  @Public()
  @Post('tournamentinfo')
  tournamentInfo(@Body() gti: GetTournamentInfoDto) {
    return this.factoryService.getTournamentInfo(gti);
  }

  @Public()
  @Post('eventdata')
  eventData(@Body() ged: GetEventDataDto) {
    return this.factoryService.getEventData(ged);
  }

  @Post()
  @Roles(['client'])
  @HttpCode(HttpStatus.OK)
  executionQueue(@Body() eqd: ExecutionQueueDto) {
    return this.factoryService.executionQueue(eqd);
  }

  @Post('fetch')
  @Roles(['client'])
  @HttpCode(HttpStatus.OK)
  fetchTournamentRecords(@Body() ftd: FetchTournamentRecordsDto) {
    return this.factoryService.fetchTournamentRecords(ftd);
  }

  @Post('generate')
  @Roles(['client'])
  @HttpCode(HttpStatus.OK)
  generateTournamentRecord(@Body() gtd: any) {
    return this.factoryService.generateTournamentRecord(gtd);
  }

  @Post('query')
  @Roles(['client'])
  @HttpCode(HttpStatus.OK)
  queryTournamentRecords(@Body() qtd: QueryTournamentRecordsDto) {
    return this.factoryService.queryTournamentRecords(qtd);
  }

  @Post('remove')
  @Roles(['client'])
  @HttpCode(HttpStatus.OK)
  removeTournamentRecords(@Body() rtd: RemoveTournamentRecordsDto) {
    return this.factoryService.removeTournamentRecords(rtd);
  }

  @Post('save')
  @Roles(['client'])
  @HttpCode(HttpStatus.OK)
  saveTournamentRecords(@Body() std: SaveTournamentRecordsDto) {
    return this.factoryService.saveTournamentRecords(std);
  }
}
