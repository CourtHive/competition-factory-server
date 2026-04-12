import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';

import { BoltHistoryService } from './bolt-history.service';
import { CLIENT, SCORE, SUPER_ADMIN } from 'src/common/constants/roles';
import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/modules/auth/guards/role.guard';

@UseGuards(RolesGuard)
@Controller('api/bolt-history/reports')
export class BoltHistoryReportsController {
  constructor(private readonly service: BoltHistoryService) {}

  @Get('player/:participantId')
  @Roles([CLIENT, SCORE, SUPER_ADMIN])
  async playerStats(
    @Param('participantId') participantId: string,
    @Query('tournamentId') tournamentId?: string,
  ) {
    const result = await this.service.getPlayerPointStats({ participantId, tournamentId });
    if (result.error) throw new BadRequestException(result.error);
    return { stats: result.stats };
  }

  @Get('tournament/:tournamentId/leaders')
  @Roles([CLIENT, SCORE, SUPER_ADMIN])
  async tournamentLeaders(
    @Param('tournamentId') tournamentId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    if (limit && (!Number.isFinite(parsedLimit) || (parsedLimit ?? 0) < 1)) {
      throw new BadRequestException('limit must be a positive integer');
    }
    const result = await this.service.getTournamentLeaders({ tournamentId, limit: parsedLimit });
    if (result.error) throw new BadRequestException(result.error);
    return { leaders: result.leaders ?? [] };
  }
}
