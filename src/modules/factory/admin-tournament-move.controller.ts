import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { UserCtx, type UserContext } from '../account/auth/decorators/user-context.decorator';
import { AdminTournamentMoveService, type MoveProviderRequest } from './admin-tournament-move.service';
import { Roles } from '../account/auth/decorators/roles.decorator';
import { RolesGuard } from '../account/auth/guards/role.guard';
import { SUPER_ADMIN } from 'src/common/constants/roles';

/**
 * Super-admin repair of a tournament's provider, called from the AMS console. Very low frequency by design (CA,
 * 2026-11-07): a provisioner created something under the wrong provider and a super-admin puts it right.
 *
 * `dryRun: true` returns the plan (every binding before/after and what blocks the move) and writes nothing. A real
 * move needs a `reason` and a `commandId`; resending the same command returns the original answer.
 */
@Controller('admin/tournaments')
@UseGuards(RolesGuard)
@Roles([SUPER_ADMIN])
export class AdminTournamentMoveController {
  constructor(private readonly moves: AdminTournamentMoveService) {}

  @Post(':tournamentId/move-provider')
  @HttpCode(HttpStatus.OK)
  async moveProvider(
    @Param('tournamentId') tournamentId: string,
    @Body() body: Omit<MoveProviderRequest, 'tournamentId'>,
    @UserCtx() userContext: UserContext,
  ) {
    if (!body || typeof body !== 'object') throw new BadRequestException('Body required');
    return this.moves.moveProvider({ ...body, tournamentId }, userContext);
  }
}
