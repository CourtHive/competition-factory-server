/**
 * HiveIDTournamentController — the SPLIT (tournament-reading) `/auth/hiveid/*`
 * routes, extracted from the account/auth HiveIDController so they survive the
 * Phase-3 drop of the MOVE account tree. The rest of `/auth/hiveid/*` (signup /
 * verify-existing / magic-link / me / resend / contact-email) is MOVE and lives
 * on the IdP after cutover; these read CFS tournament records and stay on CFS
 * (nginx carve-outs pin `^~ me/claimable/`, `= me/claim`).
 *
 * `me/participations` was REMOVED here — it no longer needs tournament records
 * (pure read-model SQL) and moved to the dedicated courthive-query service to
 * kill the all-records scan on the mutation event loop (punch-list C1 / A7).
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';

import { HiveIDTournamentService } from './hiveid-tournament.service';
import { Audience } from 'src/modules/account/auth/decorators/audience.decorator';
import { HiveIDClaimDto } from './dto/hiveidClaim.dto';

@Controller('auth/hiveid')
export class HiveIDTournamentController {
  constructor(private readonly hiveidTournamentService: HiveIDTournamentService) {}

  /**
   * GET /auth/hiveid/me/claimable/:tournamentId — Participants in the given
   * tournament whose name overlaps the caller's cached canonical fields, minus
   * anyone already linked to this personId.
   */
  @Audience(['hiveid'])
  @Get('me/claimable/:tournamentId')
  @HttpCode(HttpStatus.OK)
  getClaimable(@Param('tournamentId') tournamentId: string, @Req() req: any) {
    return this.hiveidTournamentService.getClaimableForTournament(req?.user?.userId, tournamentId);
  }

  /**
   * POST /auth/hiveid/me/claim — link a tournament Participant to the caller's
   * CourtHive identity by stamping a CANONICAL_PERSON entry on
   * `Person.personOtherIds[]` via the `addPersonOtherId` factory mutation.
   */
  @Audience(['hiveid'])
  @Post('me/claim')
  @HttpCode(HttpStatus.OK)
  claim(@Body() body: HiveIDClaimDto, @Req() req: any) {
    return this.hiveidTournamentService.claimParticipant({
      userId: req?.user?.userId,
      tournamentId: body?.tournamentId ?? '',
      participantId: body?.participantId ?? '',
    });
  }
}
