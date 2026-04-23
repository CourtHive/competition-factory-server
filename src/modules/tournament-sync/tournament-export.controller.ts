import { Controller, Get, Param, Logger, Headers, UnauthorizedException } from '@nestjs/common';

import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { Public } from 'src/modules/auth/decorators/public.decorator';
import { RelayConfig } from '../relay/relay.config';

/**
 * Cloud-only controller that exposes tournament records for local arena
 * instances to pull during pre-event setup.
 *
 * Auth: Bearer token must match UPSTREAM_API_KEY — a dedicated
 * service-to-service key shared between the cloud and local instances.
 */
@Controller('factory/tournaments')
export class TournamentExportController {
  private readonly logger = new Logger(TournamentExportController.name);

  constructor(
    private readonly storageService: TournamentStorageService,
    private readonly config: RelayConfig,
  ) {}

  /**
   * GET /factory/tournaments — list all tournament IDs available on this instance.
   */
  @Get()
  @Public()
  async listTournaments(@Headers('authorization') authHeader: string | undefined) {
    this.validateServiceAuth(authHeader);

    const tournamentIds = await this.storageService.listTournamentIds();
    return { success: true, tournamentIds };
  }

  /**
   * GET /factory/tournaments/:tournamentId/export — return the full tournament record.
   */
  @Get(':tournamentId/export')
  @Public()
  async exportTournament(
    @Param('tournamentId') tournamentId: string,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    this.validateServiceAuth(authHeader);

    const result = await this.storageService.findTournamentRecord({ tournamentId });
    if (result.error || !result.tournamentRecord) {
      this.logger.warn(`export: tournament ${tournamentId} not found`);
      return { error: 'Tournament not found' };
    }

    this.logger.log(`export: ${tournamentId}`);
    return { success: true, tournamentRecord: result.tournamentRecord };
  }

  private validateServiceAuth(authHeader: string | undefined): void {
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new UnauthorizedException('missing api key');

    const expected = this.config.upstreamApiKey;
    if (!expected || token !== expected) throw new UnauthorizedException('invalid api key');
  }
}
