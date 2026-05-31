/**
 * RegistrationsController — applicant-side `/me/registrations` surface
 * for HiveID Phase 2-A. All routes require `aud: 'hiveid'` (or array
 * including hiveid); admin-only tokens are rejected by the AuthGuard
 * audience check.
 */
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';

import { ApplyRegistrationDto } from './dto/applyRegistration.dto';
import { Audience } from '../auth/decorators/audience.decorator';
import { RegistrationsService } from './registrations.service';

@Controller('me/registrations')
@Audience(['hiveid'])
export class RegistrationsController {
  constructor(private readonly registrationsService: RegistrationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(@Req() req: any) {
    return this.registrationsService.listForUser(req?.user?.userId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  apply(@Body() body: ApplyRegistrationDto, @Req() req: any) {
    return this.registrationsService.apply({
      userId: req?.user?.userId,
      tournamentId: body?.tournamentId ?? '',
      eventIds: body?.eventIds,
      partnerUserId: body?.partnerUserId,
      answers: body?.answers,
    });
  }

  @Delete(':registrationId')
  @HttpCode(HttpStatus.OK)
  withdraw(@Param('registrationId') registrationId: string, @Req() req: any) {
    return this.registrationsService.withdraw(req?.user?.userId, registrationId);
  }
}
