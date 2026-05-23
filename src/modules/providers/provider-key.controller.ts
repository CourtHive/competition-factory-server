import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';

import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { FactoryService } from '../factory/factory.service';

import { ProviderApiKeyGuard } from './provider-api-key.guard';

/**
 * Provider-key-scoped REST surface. Authenticated by `pkey_live_*` Bearer
 * tokens (see ProviderApiKeyMiddleware). Every endpoint operates ONLY on
 * `req.provider.providerId` — no cross-provider access, no header indirection.
 *
 * v1 capabilities (per design decision 2026-05-23):
 *   • GET  /provider-key/self                     — what provider does this key represent?
 *   • POST /provider-key/tournaments              — create or save a tournament
 *   • GET  /provider-key/tournaments/:id          — read a single tournament (if owned)
 */
@Controller('provider-key')
@UseGuards(ProviderApiKeyGuard)
export class ProviderKeyController {
  constructor(
    private readonly factoryService: FactoryService,
    private readonly tournamentStorageService: TournamentStorageService,
  ) {}

  @Get('self')
  async self(@Req() req: any) {
    const p = req.provider;
    return {
      success: true,
      provider: {
        providerId: p.providerId,
        providerName: p.providerName,
        keyId: p.keyId,
        keyLabel: p.keyLabel,
      },
    };
  }

  /**
   * Save (create or update) a tournament record under this provider.
   *
   * Enforces that `tournamentRecord.parentOrganisation.organisationId`
   * matches the authenticated provider — clients cannot land tournaments
   * under another provider by manipulating the payload.
   */
  @Post('tournaments')
  @HttpCode(HttpStatus.OK)
  async saveTournament(@Body() body: { tournamentRecord?: any; tournamentRecords?: Record<string, any> }, @Req() req: any) {
    const authedProviderId: string = req.provider.providerId;

    const records = body.tournamentRecords
      ? body.tournamentRecords
      : body.tournamentRecord
        ? { [body.tournamentRecord.tournamentId]: body.tournamentRecord }
        : null;

    if (!records || !Object.keys(records).length) {
      return { error: 'No tournamentRecord provided' };
    }

    // Reject any tournament whose parentOrganisation doesn't match the
    // key's provider. Returning 404-style "not found" rather than 403
    // would be friendlier to misconfigured callers, but here the caller
    // explicitly tried to write under another provider — refuse loudly.
    for (const [tid, record] of Object.entries(records)) {
      const parentOrgId = (record as any)?.parentOrganisation?.organisationId;
      if (parentOrgId && parentOrgId !== authedProviderId) {
        return {
          error: 'Provider mismatch',
          tournamentId: tid,
          message: `Tournament ${tid} parentOrganisation.organisationId does not match the authenticated provider.`,
        };
      }
      // If parentOrganisation is missing, stamp it from the key — saves
      // callers the boilerplate of repeating their own providerId.
      if (!parentOrgId) {
        (record as any).parentOrganisation = {
          ...((record as any).parentOrganisation ?? {}),
          organisationId: authedProviderId,
        };
      }
    }

    return this.factoryService.saveTournamentRecords({ tournamentRecords: records }, req.user, req.userContext);
  }

  @Get('tournaments/:tournamentId')
  async getTournament(@Param('tournamentId') tournamentId: string, @Req() req: any) {
    const result: any = await this.tournamentStorageService.fetchTournamentRecords({ tournamentId });
    const tournament = result?.tournamentRecords?.[tournamentId];
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }
    const parentOrgId = tournament?.parentOrganisation?.organisationId;
    // Return 404 rather than 403 so attackers can't probe for the
    // existence of tournaments belonging to other providers.
    if (parentOrgId !== req.provider.providerId) {
      throw new NotFoundException('Tournament not found');
    }
    return { success: true, tournamentRecord: tournament };
  }
}
