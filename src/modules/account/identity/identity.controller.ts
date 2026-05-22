import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { UserCtx, type UserContext } from '../auth/decorators/user-context.decorator';
import { SetContactEmailDto } from './dto/setContactEmail.dto';
import { CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../auth/decorators/user.decorator';
import { IdentityService } from './identity.service';

@Controller()
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  /**
   * Set or change the caller's `contact_email`. Always clears
   * `email_verified_at` (the storage layer enforces this) and fires a
   * fresh verification email.
   */
  @Post('account/contact-email/set')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  setContactEmail(
    @Body() body: SetContactEmailDto,
    @User() user?: any,
    @UserCtx() userContext?: UserContext,
  ) {
    if (!userContext?.userId) return { error: 'Authentication required' };
    return this.identityService.setContactEmail(
      { userId: userContext.userId, firstName: user?.firstName },
      body?.contactEmail ?? '',
    );
  }

  /**
   * Re-send the verification email if the caller has a pending
   * (unverified) contact_email. Idempotent — no-op when already verified
   * or when no contact_email is set.
   */
  @Post('account/contact-email/resend-verification')
  @Roles([CLIENT, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  resendVerification(@User() user?: any, @UserCtx() userContext?: UserContext) {
    if (!userContext?.userId || !userContext.email) {
      return { error: 'Authentication required' };
    }
    return this.identityService.resendVerification({
      userId: userContext.userId,
      email: userContext.email,
      firstName: user?.firstName,
    });
  }

  /**
   * Public endpoint — the verification link's `Verify` button POSTs
   * here with the limited token from the URL. The token itself is the
   * auth; nothing else is needed.
   */
  @Public()
  @Post('auth/verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() body: { token: string }) {
    return this.identityService.verifyEmailToken(body?.token);
  }
}
