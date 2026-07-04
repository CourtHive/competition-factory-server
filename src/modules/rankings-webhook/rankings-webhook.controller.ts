// Admin endpoint for manually republishing a tournament to the
// courthive-rankings pipeline. Reads the tournament record from
// CFS's storage and POSTs it via RankingsWebhookService.
//
// Usage: POST /admin/rankings-webhook/republish/:tournamentId
//   { force?: boolean }   — currently no-op; reserved for future
//                           bypass of webhook-enabled checks
//
// Returns:
//   { skipped: true } when RANKINGS_PIPELINE_URL is unset
//   { ok: true, status: 202, attempts: 1, responseBody: { ingestionRunId, ... } }
//
// The auto-trigger on tournament save is NOT wired here. Operators
// can call this endpoint to backfill specific tournaments; deeper
// auto-publish integration is a follow-up.

import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';

import { ADMIN, CLIENT, PROVIDER_ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { UserCtx, type UserContext } from '../account/auth/decorators/user-context.decorator';
import { ProviderRankingsService } from './provider-rankings.service';
import { RankingsWebhookService } from './rankings-webhook.service';
import { Roles } from '../account/auth/decorators/roles.decorator';
import { RolesGuard } from '../account/auth/guards/role.guard';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';

@UseGuards(RolesGuard)
@Controller('admin/rankings-webhook')
export class RankingsWebhookController {
  constructor(
    private readonly webhook: RankingsWebhookService,
    private readonly providerRankings: ProviderRankingsService,
    private readonly tournamentStorage: TournamentStorageService,
  ) {}

  // Provider-scoped recompute: republish all of a provider's tournaments to the
  // rankings pipeline (refreshing the live rankings page) + regenerate formal
  // snapshots per age-category × gender. Only a PROVIDER_ADMIN of the target
  // provider (or a super-admin) may run it.
  @Post('republish-provider/:providerId')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async republishProvider(
    @Param('providerId') providerId: string,
    @Body() body: { ageCategoryCodes?: string[] },
    @UserCtx() ctx?: UserContext,
  ) {
    if (!providerId) return { error: 'providerId required' };
    const isProviderAdmin = ctx?.providerRoles?.[providerId] === PROVIDER_ADMIN;
    if (!ctx?.isSuperAdmin && !isProviderAdmin) {
      throw new ForbiddenException('PROVIDER_ADMIN role required');
    }
    return this.providerRankings.recompute({ providerId, ageCategoryCodes: body?.ageCategoryCodes });
  }

  @Post('republish/:tournamentId')
  @Roles([ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async republish(@Param('tournamentId') tournamentId: string) {
    const result = await this.tournamentStorage.fetchTournamentRecords({ tournamentId });
    const tournamentRecord = (result as any)?.tournamentRecords?.[tournamentId];
    if (!tournamentRecord) {
      throw new NotFoundException(`tournament ${tournamentId} not found`);
    }

    return this.webhook.publish(tournamentRecord, {
      source: 'cfs-event',
      sourceRef: `admin-republish:${tournamentId}`,
    });
  }
}
