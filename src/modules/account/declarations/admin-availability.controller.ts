/**
 * AdminAvailabilityController — director-side TD availability pull. Mounted at
 * `/admin/tournaments/:tournamentId/availability`. Audience is the default
 * `admin`; the per-tournament authorisation gate runs inside the service via
 * canMutateTournament.
 */
import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { AvailabilityPullService } from './availability-pull.service';
import { CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserCtx, type UserContext } from '../auth/decorators/user-context.decorator';

@Controller('admin/tournaments/:tournamentId/availability')
@Roles([CLIENT, SUPER_ADMIN])
export class AdminAvailabilityController {
  constructor(private readonly availabilityPullService: AvailabilityPullService) {}

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  pull(@Param('tournamentId') tournamentId: string, @UserCtx() userContext: UserContext) {
    return this.availabilityPullService.pull({ userContext, tournamentId });
  }
}
