import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';

import { UserCtx, type UserContext } from '../account/auth/decorators/user-context.decorator';
import { CreateGrantDto, ListGrantsDto } from './dto/createGrant.dto';
import { RolesGuard } from '../account/auth/guards/role.guard';
import { Roles } from '../account/auth/decorators/roles.decorator';
import { CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';
import { GrantsService } from './grants.service';

/**
 * Write API for scoped, time-bounded capability grants.
 *
 * Deliberately in CFS rather than AMS: `tournament_grants` is authorization
 * enforced at `executionQueue` time, and per PROVIDER_SERVICES_BOUNDARY.md the
 * gating tier stays authoritative where mutations execute. The AMS console
 * renders from its own read-only pool and calls these routes to write, so a
 * grant cannot be created that the gate would not honour.
 *
 * Every route authorizes with `isProviderAdminFor` against the provider that
 * owns the row — read from the tournament record on create/list and from the
 * grant itself on revoke, never from the request body.
 *
 * `@UseGuards(RolesGuard)` is load-bearing, not decoration: the globally
 * registered `AuthGuard` enforces authentication and audience only, so `@Roles`
 * binds to nothing unless this guard is attached to the controller.
 */
@UseGuards(RolesGuard)
@Controller('factory/grants')
export class GrantsController {
  constructor(private readonly grantsService: GrantsService) {}

  /** Grants on a tournament. Static path declared before the parameterised route. */
  @Post('list')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  list(@Body() body: ListGrantsDto, @UserCtx() ctx?: UserContext) {
    return this.grantsService.listForTournament(body?.tournamentId, ctx);
  }

  /** Create a grant. */
  @Post()
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  create(@Body() body: CreateGrantDto, @UserCtx() ctx?: UserContext) {
    return this.grantsService.create(body, ctx);
  }

  /** Revoke a grant. */
  @Delete(':grantId')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  revoke(@Param('grantId') grantId: string, @UserCtx() ctx?: UserContext) {
    return this.grantsService.revoke(grantId, ctx);
  }
}
