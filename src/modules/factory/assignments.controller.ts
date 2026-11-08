import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { UserCtx, type UserContext } from '../account/auth/decorators/user-context.decorator';
import { AssignmentsService } from './assignments.service';

// No @Roles: authorization is in the service, against the tournament (AssignmentsService: the tournament's owning
// provider's admin, or a super-admin). A @Roles here enforced nothing —
// no RolesGuard ran — and read as a check that did not happen (removed 2026-11-08).
@Controller('factory/assignments')
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  /**
   * List assignments for a specific tournament, or all assignments for the
   * requesting user (when no tournamentId is provided).
   */
  @Post('list')
  @HttpCode(HttpStatus.OK)
  list(@Body() body: { tournamentId?: string }, @UserCtx() ctx: UserContext) {
    return this.assignmentsService.list(body, ctx);
  }

  /**
   * Grant a user access to a tournament.
   * Grantor must be PROVIDER_ADMIN for the tournament's provider or SUPER_ADMIN.
   * Grantee must have a user_providers row for the same provider.
   */
  @Post('grant')
  @HttpCode(HttpStatus.OK)
  grant(
    @Body() body: { tournamentId: string; userEmail: string; providerId: string; role?: string },
    @UserCtx() ctx: UserContext,
  ) {
    return this.assignmentsService.grant(body, ctx);
  }

  /**
   * Revoke a user's access to a tournament.
   */
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  revoke(@Body() body: { tournamentId: string; userEmail: string; providerId: string }, @UserCtx() ctx: UserContext) {
    return this.assignmentsService.revoke(body, ctx);
  }

  /**
   * List users in a provider who are eligible to be granted access.
   * For the manage-access UI's autocomplete picker.
   */
  @Post('eligible-users')
  @HttpCode(HttpStatus.OK)
  eligibleUsers(@Body() body: { providerId: string }, @UserCtx() ctx: UserContext) {
    return this.assignmentsService.eligibleUsers(body, ctx);
  }
}
