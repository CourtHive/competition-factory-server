import { RemoveTournamentRecordsDto } from './dto/removeTournamentRecords.dto';
import { ExecutionQueueDto } from './dto/executionQueue.dto';

import { Public } from '../../auth/decorators/public.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/role.guard';
import { FactoryService } from './factory.service';
import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  Body,
  UseGuards,
} from '@nestjs/common';

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

  @Post()
  @Roles(['client'])
  @HttpCode(HttpStatus.OK)
  executionQueue(@Body() eqd: ExecutionQueueDto) {
    return this.factoryService.executionQueue(eqd);
  }

  @Post('remove')
  @Roles(['client'])
  @HttpCode(HttpStatus.OK)
  removeTournamentRecords(@Body() rtd: RemoveTournamentRecordsDto) {
    return this.factoryService.removeTournamentRecords(rtd);
  }

  @Post('generate')
  @Roles(['client'])
  @HttpCode(HttpStatus.OK)
  generateTournamentRecord(@Body() gtd: any) {
    return this.factoryService.generateTournamentRecord(gtd);
  }
}
