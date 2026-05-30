/**
 * HiveIDController — public-facing sibling to AuthController.
 *
 * Routes are split between two audience modes:
 *
 *   @Public()             — signup / verify-existing / magic-link request +
 *                            consume. Callers are by definition not
 *                            authenticated; the body or single-use code is
 *                            the credential.
 *
 *   @Audience(['hiveid']) — GET /me. AuthGuard verifies the JWT and admits
 *                            it only when the token's `aud` claim includes
 *                            `'hiveid'`.
 *
 * No admin-side route lives here; AuthController owns the admin surface.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Audience } from './decorators/audience.decorator';
import { HiveIDMagicLinkConsumeDto, HiveIDMagicLinkRequestDto } from './dto/hiveidMagicLink.dto';
import { HiveIDVerifyExistingDto } from './dto/hiveidVerifyExisting.dto';
import { HiveIDSignupDto } from './dto/hiveidSignup.dto';
import { HiveIDService } from './hiveid.service';
import { Public } from './decorators/public.decorator';

@Controller('auth/hiveid')
export class HiveIDController {
  constructor(private readonly hiveidService: HiveIDService) {}

  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.OK)
  signup(@Body() body: HiveIDSignupDto, @Req() req?: any) {
    return this.hiveidService.signup(body, req?.headers?.['user-agent']);
  }

  @Public()
  @Post('verify-existing')
  @HttpCode(HttpStatus.OK)
  verifyExisting(@Body() body: HiveIDVerifyExistingDto, @Req() req?: any) {
    return this.hiveidService.verifyExisting(body, req?.headers?.['user-agent']);
  }

  @Public()
  @Post('magic-link')
  @HttpCode(HttpStatus.OK)
  requestMagicLink(@Body() body: HiveIDMagicLinkRequestDto) {
    return this.hiveidService.requestMagicLink(body?.email ?? '');
  }

  @Public()
  @Post('magic-link/consume')
  @HttpCode(HttpStatus.OK)
  consumeMagicLink(@Body() body: HiveIDMagicLinkConsumeDto, @Req() req?: any) {
    return this.hiveidService.consumeMagicLink(body?.code ?? '', req?.headers?.['user-agent']);
  }

  @Audience(['hiveid'])
  @Get('me')
  @HttpCode(HttpStatus.OK)
  getMe(@Req() req: any) {
    return this.hiveidService.getMe(req?.user?.userId);
  }
}
