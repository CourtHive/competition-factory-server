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
import { CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';
import { RegistrationsService } from './registrations.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserCtx, type UserContext } from '../auth/decorators/user-context.decorator';

@Controller('admin/tournaments/:tournamentId/registrations')
@Roles([CLIENT, SUPER_ADMIN])
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
}
