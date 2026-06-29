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
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { Audience } from './decorators/audience.decorator';
import { HiveIDMagicLinkConsumeDto, HiveIDMagicLinkRequestDto } from './dto/hiveidMagicLink.dto';
import { HiveIDVerifyExistingDto } from './dto/hiveidVerifyExisting.dto';
import { HiveIDClaimDto } from './dto/hiveidClaim.dto';
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

  /**
   * POST /auth/hiveid/resend-verification — re-send the email-verification
   * mail for the authenticated HiveID user. The link lands on courthive-public
   * and POSTs the token to the shared @Public `/auth/verify-email` endpoint.
   */
  @Audience(['hiveid'])
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  resendVerification(@Req() req: any) {
    return this.hiveidService.resendVerification({
      userId: req?.user?.userId,
      email: req?.user?.email,
      firstName: req?.user?.firstName,
    });
  }

  /**
   * GET /auth/hiveid/me/participations — every tournament where the
   * caller has been claimed as a Participant via the CANONICAL_PERSON
   * organisationId. Phase 1 surface for the "instant tournament
   * history" moment after a backfilled HTS/CTS/BOBOCA user logs in.
   */
  @Audience(['hiveid'])
  @Get('me/participations')
  @HttpCode(HttpStatus.OK)
  getMyParticipations(@Req() req: any) {
    return this.hiveidService.getMyParticipations(req?.user?.userId);
  }

  /**
   * GET /auth/hiveid/me/claimable/:tournamentId — Participants in the
   * given tournament whose name overlaps the caller's cached canonical
   * fields, minus anyone already linked to this personId.
   */
  @Audience(['hiveid'])
  @Get('me/claimable/:tournamentId')
  @HttpCode(HttpStatus.OK)
  getClaimable(@Param('tournamentId') tournamentId: string, @Req() req: any) {
    return this.hiveidService.getClaimableForTournament(req?.user?.userId, tournamentId);
  }

  /**
   * POST /auth/hiveid/me/claim — link a tournament Participant to the
   * caller's CourtHive identity by stamping a CANONICAL_PERSON entry on
   * `Person.personOtherIds[]` via the `addPersonOtherId` factory mutation.
   */
  @Audience(['hiveid'])
  @Post('me/claim')
  @HttpCode(HttpStatus.OK)
  claim(@Body() body: HiveIDClaimDto, @Req() req: any) {
    return this.hiveidService.claimParticipant({
      userId: req?.user?.userId,
      tournamentId: body?.tournamentId ?? '',
      participantId: body?.participantId ?? '',
    });
  }
}
