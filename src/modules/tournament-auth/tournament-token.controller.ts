/**
 * TournamentTokenController — the SPLIT relay-token mints, extracted from the
 * account/auth AuthController so they survive the Phase-3 drop of the MOVE
 * account tree. These mint tournament-scoped relay tokens: CFS keeps the
 * tournament/provider AUTHORIZATION (TrackerTokenService.canMutateTournament)
 * and delegates only SIGNING to the IdP via SplitTokenSigner (Increment 4).
 *
 * Routes stay under `@Controller('auth')` so the nginx cutover can pin
 * `= /auth/tracker-token`, `= /auth/scorer-token`, `= /auth/provider-scoring-token`
 * back to CFS while the rest of `/auth/*` flips to the IdP.
 */
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';

import { UserCtx, type UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';
import { ProviderScoringTokenDto } from './dto/providerScoringToken.dto';
import { SUPER_ADMIN, SCORE } from 'src/common/constants/roles';
import { Audience } from 'src/modules/account/auth/decorators/audience.decorator';
import { TrackerTokenService } from './tracker-token.service';
import { TrackerTokenDto } from './dto/trackerToken.dto';
import { ScorerTokenDto } from './dto/scorerToken.dto';
import { Roles } from 'src/modules/account/auth/decorators/roles.decorator';
import { User } from 'src/modules/account/auth/decorators/user.decorator';
import { Throttle } from '@nestjs/throttler';

// Per-IP rate limit for single-use-code / token guessing on the public token
// surface, layered on the global 300/60s default (see app.module.ts).
const TOKEN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class TournamentTokenController {
  constructor(private readonly trackerTokenService: TrackerTokenService) {}

  /**
   * POST /auth/tracker-token — mint a short-lived JWT scoped to a single
   * tournament for external score publishers (notably IONSport). Provider
   * API-key middleware grants SCORE; the service runs canMutateTournament so
   * the caller can only mint for tournaments it owns. TTL default 1h; max 8h.
   */
  @Post('tracker-token')
  @Roles([SCORE, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async mintTrackerToken(
    @Body() body: TrackerTokenDto,
    @User() user: any,
    @UserCtx() userContext: UserContext,
    @Req() req?: any,
  ) {
    return this.trackerTokenService.mintTrackerToken(
      { tournamentId: body.tournamentId, ttlSeconds: body.ttlSeconds },
      {
        userId: user?.userId,
        providerId: user?.providerId,
        provisionerId: req?.provisioner?.provisionerId,
      },
      userContext,
    );
  }

  /**
   * POST /auth/provider-scoring-token — mint a `provider`-audience relay token
   * so a provider's own client app (e.g. IONSport) can be a score-relay client.
   * Same provider API-key + ownership gate as /auth/tracker-token; scoped to one
   * tournament and carrying the provider-attested scorer identity.
   */
  @Post('provider-scoring-token')
  @Roles([SCORE, SUPER_ADMIN])
  @HttpCode(HttpStatus.OK)
  async mintProviderScoringToken(
    @Body() body: ProviderScoringTokenDto,
    @User() user: any,
    @UserCtx() userContext: UserContext,
    @Req() req?: any,
  ) {
    return this.trackerTokenService.mintProviderScoringToken(
      {
        tournamentId: body.tournamentId,
        personId: body.personId,
        displayName: body.displayName,
        verified: body.verified,
        ttlSeconds: body.ttlSeconds,
      },
      {
        userId: user?.userId,
        providerId: user?.providerId,
        provisionerId: req?.provisioner?.provisionerId,
      },
      userContext,
    );
  }

  /**
   * POST /auth/scorer-token — mint a short-lived `score`-audience relay token
   * for the authenticated HiveID user so a launched external scorer (epixodic)
   * relays crowd scores AS this person. Gated on the caller's HiveID session
   * (@Audience(['hiveid'])); identity claims are read from the session, never
   * the body. No tournament-ownership check and no tournament-record read.
   */
  @Post('scorer-token')
  @Audience(['hiveid'])
  @Throttle(TOKEN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async mintScorerToken(@Body() body: ScorerTokenDto, @User() user: any) {
    return this.trackerTokenService.mintScorerToken(
      {
        tournamentId: body.tournamentId,
        matchUpId: body.matchUpId,
        displayName: body.displayName,
        ttlSeconds: body.ttlSeconds,
      },
      {
        userId: user?.userId,
        personId: user?.personId,
        verified: user?.email_verified === true,
      },
    );
  }
}
