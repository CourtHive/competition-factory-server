/**
 * AdminRegistrationsController — director-side accept surface (HiveID Phase 2-B).
 *
 * Mounted at `/admin/tournaments/:tournamentId/registrations`. Audience is the
 * default `admin`; AuthGuard rejects pure HiveID tokens here. The per-tournament
 * authorisation gate (`assertAdminAccess`) is enforced inside the service.
 *
 * ACCEPT is the ONLY action CFS owns — it runs `addParticipants` (the one
 * tournamentRecord mutation) and stamps the decision back in the declarations
 * service. The pending list + reject/waitlist live off CFS: TMX reads/decides them
 * directly against courthive-declarations (see its ProviderAdminGuard).
 */
import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { AdminRegistrationActionDto } from './dto/adminRegistrationAction.dto';
import { RegistrationsService } from './registrations.service';
import { UserCtx, type UserContext } from '../auth/decorators/user-context.decorator';

// No @Roles: authorization is in the service, against the tournament (RegistrationsService: canMutateTournament). A @Roles here enforced nothing —
// no RolesGuard ran — and read as a check that did not happen (removed 2026-11-08).
@Controller('admin/tournaments/:tournamentId/registrations')
export class AdminRegistrationsController {
  constructor(private readonly registrationsService: RegistrationsService) {}

  @Post(':registrationId/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @Param('tournamentId') tournamentId: string,
    @Param('registrationId') registrationId: string,
    @Body() body: AdminRegistrationActionDto,
    @UserCtx() userContext: UserContext,
  ) {
    return this.registrationsService.acceptRegistration({
      userContext,
      tournamentId,
      registrationId,
      statusReason: body?.statusReason,
    });
  }

  // Bulk accept in a SINGLE executionQueue (one lock, one save) — pass explicit
  // registrationIds, or omit them to accept all pending for the tournament. Returns a
  // per-registration result array (partial success); pairs are folded in idempotently.
  @Post('accept-bulk')
  @HttpCode(HttpStatus.OK)
  async acceptBulk(
    @Param('tournamentId') tournamentId: string,
    @Body() body: { registrationIds?: string[]; statusReason?: string },
    @UserCtx() userContext: UserContext,
  ) {
    const { results } = await this.registrationsService.acceptMany({
      userContext,
      tournamentId,
      registrationIds: body?.registrationIds,
      statusReason: body?.statusReason,
    });
    return { results };
  }
}
