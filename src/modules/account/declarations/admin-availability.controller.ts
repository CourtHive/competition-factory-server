/**
 * AdminAvailabilityController — director-side TD availability pull. Mounted at
 * `/admin/tournaments/:tournamentId/availability`. Audience is the default
 * `admin`; the per-tournament authorisation gate runs inside the service via
 * canMutateTournament.
 */
import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { AvailabilityPullService } from './availability-pull.service';
import { UserCtx, type UserContext } from '../auth/decorators/user-context.decorator';

// No @Roles: authorization is in the service, against the tournament (AvailabilityPullService: canMutateTournament). A @Roles here enforced nothing —
// no RolesGuard ran — and read as a check that did not happen (removed 2026-11-08).
@Controller('admin/tournaments/:tournamentId/availability')
export class AdminAvailabilityController {
  constructor(private readonly availabilityPullService: AvailabilityPullService) {}

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  pull(@Param('tournamentId') tournamentId: string, @UserCtx() userContext: UserContext) {
    return this.availabilityPullService.pull({ userContext, tournamentId });
  }
}
