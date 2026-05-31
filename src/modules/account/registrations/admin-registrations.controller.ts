/**
 * AdminRegistrationsController — director-side surface (HiveID Phase 2-B).
 *
 * Mounted at `/admin/tournaments/:tournamentId/registrations`. Audience is
 * the default `admin`; AuthGuard rejects pure HiveID tokens here. The
 * per-tournament authorisation gate (`assertAdminAccess`) is enforced
 * inside the service via the existing `canMutateTournament` helper.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import { AdminRegistrationActionDto, AdminRegistrationBulkDto } from './dto/adminRegistrationAction.dto';
import { CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';
import { RegistrationStatus } from 'src/storage/interfaces';
import { RegistrationsService } from './registrations.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserCtx, type UserContext } from '../auth/decorators/user-context.decorator';

@Controller('admin/tournaments/:tournamentId/registrations')
@Roles([CLIENT, SUPER_ADMIN])
export class AdminRegistrationsController {
  constructor(private readonly registrationsService: RegistrationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @Param('tournamentId') tournamentId: string,
    @Query('status') status: RegistrationStatus | undefined,
    @UserCtx() userContext: UserContext,
  ) {
    return this.registrationsService.listForTournament(userContext, tournamentId, status);
  }

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

  @Post(':registrationId/waitlist')
  @HttpCode(HttpStatus.OK)
  waitlist(
    @Param('tournamentId') tournamentId: string,
    @Param('registrationId') registrationId: string,
    @Body() body: AdminRegistrationActionDto,
    @UserCtx() userContext: UserContext,
  ) {
    return this.registrationsService.waitlistRegistration({
      userContext,
      tournamentId,
      registrationId,
      statusReason: body?.statusReason,
    });
  }

  @Post(':registrationId/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('tournamentId') tournamentId: string,
    @Param('registrationId') registrationId: string,
    @Body() body: AdminRegistrationActionDto,
    @UserCtx() userContext: UserContext,
  ) {
    return this.registrationsService.rejectRegistration({
      userContext,
      tournamentId,
      registrationId,
      statusReason: body?.statusReason,
    });
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  bulk(
    @Param('tournamentId') tournamentId: string,
    @Body() body: AdminRegistrationBulkDto,
    @UserCtx() userContext: UserContext,
  ) {
    return this.registrationsService.bulkAction({
      userContext,
      tournamentId,
      action: body.action,
      registrationIds: body.registrationIds ?? [],
      statusReason: body.statusReason,
    });
  }
}
