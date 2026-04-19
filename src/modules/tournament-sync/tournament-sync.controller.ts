import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';

import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { SUPER_ADMIN } from 'src/common/constants/roles';
import { TournamentSyncService } from './tournament-sync.service';

/**
 * Local-only controller for arena admins to manage tournament sync
 * from the upstream cloud instance.
 *
 * All endpoints require SUPER_ADMIN role.
 */
@Controller('factory/sync')
export class TournamentSyncController {
  constructor(private readonly syncService: TournamentSyncService) {}

  /**
   * GET /factory/sync/remote — list tournaments available on upstream.
   */
  @Get('remote')
  @Roles([SUPER_ADMIN])
  async listRemote() {
    return this.syncService.listRemoteTournaments();
  }

  /**
   * POST /factory/sync/pull — pull a tournament from upstream into local storage.
   */
  @Post('pull')
  @Roles([SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async pullTournament(@Body() body: { tournamentId: string }) {
    if (!body?.tournamentId) {
      return { error: 'tournamentId required' };
    }
    return this.syncService.pullTournament(body.tournamentId);
  }

  /**
   * GET /factory/sync/status — sync status for all pulled tournaments.
   */
  @Get('status')
  @Roles([SUPER_ADMIN])
  getSyncStatus() {
    return { success: true, syncStatus: this.syncService.getSyncStatus() };
  }
}
