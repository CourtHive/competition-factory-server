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

import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';

import { PROVIDER_STORAGE, type IProviderStorage } from 'src/storage/interfaces';
import { ADMIN, CLIENT, PROVIDER_ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';
import { UserCtx, type UserContext } from '../account/auth/decorators/user-context.decorator';
import { ProviderRankingsService } from './provider-rankings.service';
import { RankingsWebhookService } from './rankings-webhook.service';
import { stampRecordProvider } from './stampRecordProvider';
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
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
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
    this.assertProviderAdmin(providerId, ctx);
    return this.providerRankings.recompute({ providerId, ageCategoryCodes: body?.ageCategoryCodes });
  }

  // Republish ONLY the provider's tournaments with no current ingestion run
  // (never ingested — e.g. tournaments that finished after the last republish).
  // Same provider-scoped authorization as republishProvider.
  @Post('run-unprocessed/:providerId')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async runUnprocessed(
    @Param('providerId') providerId: string,
    @Body() body: { ageCategoryCodes?: string[] },
    @UserCtx() ctx?: UserContext,
  ) {
    if (!providerId) return { error: 'providerId required' };
    this.assertProviderAdmin(providerId, ctx);
    return this.providerRankings.runUnprocessed({ providerId, ageCategoryCodes: body?.ageCategoryCodes });
  }

  // Republish the provider's tournaments with endDate >= fromDate (a date floor
  // so a "re-run recent rankings" never reprocesses thousands of historical
  // events). Same provider-scoped authorization as republishProvider.
  @Post('rerun-from-date/:providerId')
  @Roles([CLIENT, ADMIN, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async rerunFromDate(
    @Param('providerId') providerId: string,
    @Body() body: { fromDate?: string; ageCategoryCodes?: string[] },
    @UserCtx() ctx?: UserContext,
  ) {
    if (!providerId) return { error: 'providerId required' };
    if (!body?.fromDate) return { error: 'fromDate required' };
    this.assertProviderAdmin(providerId, ctx);
    return this.providerRankings.rerunFromDate({
      providerId,
      fromDate: body.fromDate,
      ageCategoryCodes: body?.ageCategoryCodes,
    });
  }

  // A super-admin OR the target provider's PROVIDER_ADMIN may run provider-scoped
  // rankings actions. Shared by all three bulk-republish endpoints.
  private assertProviderAdmin(providerId: string, ctx?: UserContext): void {
    const isProviderAdmin = ctx?.providerRoles?.[providerId] === PROVIDER_ADMIN;
    if (!ctx?.isSuperAdmin && !isProviderAdmin) {
      throw new ForbiddenException('PROVIDER_ADMIN role required');
    }
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

    // Stamp the owning provider so the rankings ingest scopes provider_id
    // correctly (the record's organisation is otherwise blank for
    // provisioner-created tournaments). Mirrors the provider-recompute path.
    const providerId = tournamentRecord.parentOrganisation?.organisationId;
    if (providerId) {
      const provider: any = await this.providerStorage.getProvider(providerId);
      stampRecordProvider(tournamentRecord, provider);
    }

    return this.webhook.publish(tournamentRecord, {
      source: 'cfs-event',
      sourceRef: `admin-republish:${tournamentId}`,
    });
  }
}
