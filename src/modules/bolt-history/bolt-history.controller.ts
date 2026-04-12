import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { BoltHistoryService } from './bolt-history.service';
import { CLIENT, SCORE, SUPER_ADMIN } from 'src/common/constants/roles';
import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/modules/auth/guards/role.guard';
import { SaveBoltHistoryDto } from './dto/save-bolt-history.dto';

@UseGuards(RolesGuard)
@Controller('api/bolt-history')
export class BoltHistoryController {
  private readonly logger = new Logger(BoltHistoryController.name);

  constructor(private readonly service: BoltHistoryService) {}

  @Get()
  @Roles([CLIENT, SCORE, SUPER_ADMIN])
  async listForTournament(@Query('tournamentId') tournamentId?: string) {
    if (!tournamentId) throw new BadRequestException('tournamentId query parameter required');
    const result = await this.service.listForTournament(tournamentId);
    if (result.error) throw new BadRequestException(result.error);
    return { documents: result.documents ?? [] };
  }

  @Get(':tieMatchUpId')
  @Roles([CLIENT, SCORE, SUPER_ADMIN])
  async find(@Param('tieMatchUpId') tieMatchUpId: string) {
    const result = await this.service.find(tieMatchUpId);
    if (result.error === 'Bolt history not found') throw new NotFoundException(result.error);
    if (result.error) throw new BadRequestException(result.error);
    return { document: result.document };
  }

  /**
   * Fetch the parent team matchUp for a tieMatchUp.
   * Used by the fully-fresh-device hydration path on epixodic
   * BoltScoringPage when the client has nothing in localStorage and
   * no parent reverse-lookup mapping.
   */
  @Get(':tieMatchUpId/parent-matchup')
  @Roles([CLIENT, SCORE, SUPER_ADMIN])
  async parentMatchUp(@Param('tieMatchUpId') tieMatchUpId: string) {
    const result = await this.service.getParentMatchUp(tieMatchUpId);
    if (result.error === 'Bolt history not found' || result.error === 'Parent matchUp not found in tournament') {
      throw new NotFoundException(result.error);
    }
    if (result.error) throw new BadRequestException(result.error);
    return { teamMatchUp: result.teamMatchUp };
  }

  @Put(':tieMatchUpId')
  @HttpCode(HttpStatus.OK)
  @Roles([SCORE, SUPER_ADMIN])
  async upsert(@Param('tieMatchUpId') tieMatchUpId: string, @Body() body: SaveBoltHistoryDto) {
    if (!body?.document) throw new BadRequestException('document required in body');
    if (body.document.tieMatchUpId !== tieMatchUpId) {
      throw new BadRequestException('tieMatchUpId in URL must match document.tieMatchUpId');
    }
    const result = await this.service.upsert(body.document);
    if (result.error === 'VERSION_CONFLICT') {
      this.logger.warn(`VERSION_CONFLICT on bolt-history upsert for ${tieMatchUpId}`);
      return { success: false, error: 'VERSION_CONFLICT' };
    }
    if (result.error) throw new BadRequestException(result.error);
    return { success: true, version: result.version };
  }

  @Delete(':tieMatchUpId')
  @Roles([SUPER_ADMIN])
  async remove(@Param('tieMatchUpId') tieMatchUpId: string) {
    const result = await this.service.remove(tieMatchUpId);
    if (result.error) throw new BadRequestException(result.error);
    return { success: true };
  }
}
