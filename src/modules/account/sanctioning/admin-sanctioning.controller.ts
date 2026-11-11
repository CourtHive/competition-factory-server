import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { UserCtx, type UserContext } from '../auth/decorators/user-context.decorator';
import { SanctioningActivationService } from './sanctioning-activation.service';

/**
 * The AMS console's "Activate (Create Tournament)": the tournament for an APPROVED sanctioning record is created in
 * CFS, which stores tournaments, and AMS is told the record is ACTIVE.
 *
 * No @Roles: authorization is in the service, against the provider that owns the record (its PROVIDER_ADMIN, or a
 * super-admin), which only the record names.
 */
@Controller('admin/sanctioning')
export class AdminSanctioningController {
  constructor(private readonly activation: SanctioningActivationService) {}

  @Post(':sanctioningId/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('sanctioningId') sanctioningId: string, @UserCtx() userContext: UserContext) {
    return this.activation.activate(sanctioningId, userContext);
  }
}
