import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { ParticipationService, isParticipationSubjectType } from './participation.service';
import { RolesGuard } from '../account/auth/guards/role.guard';
import { Roles } from '../account/auth/decorators/roles.decorator';
import { ADMIN, SUPER_ADMIN } from 'src/common/constants/roles';

@UseGuards(RolesGuard)
@Controller('participation')
export class ParticipationController {
  constructor(private readonly participation: ParticipationService) {}

  /**
   * One subject's schedule — every competition it took part in, whoever owned them.
   *
   * Role-gated rather than membership-scoped, matching `provider/calendar/provider`: an operator
   * inspects subjects it is not a member of, which is exactly the console journey this serves.
   * A membership-scoped "my schedule" belongs alongside `my-calendars` and is not this route.
   *
   * For a TEAM the `subjectId` is the id its governing body issued, which for a team-grain provider
   * is also that provider's id — so impersonating the provider and reading its schedule use one key.
   *
   * `?organisationId=` narrows to one issuing body. A subjectId is unique only WITHIN the body that
   * issued it, so a caller that knows which body it speaks for should say so; omitting it returns
   * every body's rows for that id, which is right today and wrong the moment a second body issues
   * ids that collide.
   */
  @Get(':subjectType/:subjectId')
  @Roles([ADMIN, SUPER_ADMIN])
  async getSchedule(
    @Param('subjectType') subjectType: string,
    @Param('subjectId') subjectId: string,
    @Query('organisationId') organisationId?: string,
  ) {
    const normalised = subjectType?.toUpperCase();
    // Reject an unknown grain rather than returning an empty list: an empty result for a typo'd
    // subject type is indistinguishable from a subject that genuinely took part in nothing.
    if (!isParticipationSubjectType(normalised)) {
      throw new BadRequestException(`Unknown participation subjectType: ${subjectType}`);
    }
    return this.participation.getSchedule({ subjectType: normalised, subjectId, organisationId });
  }
}
