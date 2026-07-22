/**
 * HiveIDTournamentController — the SPLIT (tournament-reading) `/auth/hiveid/*`
 * routes, extracted from the account/auth HiveIDController so they survive the
 * Phase-3 drop of the MOVE account tree. The rest of `/auth/hiveid/*` (signup /
 * verify-existing / magic-link / me / resend / contact-email) is MOVE and lives
 * on the IdP after cutover; these three read CFS tournament records and stay on
 * CFS (nginx carve-outs pin `= me/participations`, `^~ me/claimable/`, `= me/claim`).
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';

import { HiveIDTournamentService } from './hiveid-tournament.service';
import { Audience } from 'src/modules/account/auth/decorators/audience.decorator';
import { HiveIDClaimDto } from './dto/hiveidClaim.dto';

@Controller('auth/hiveid')
export class HiveIDTournamentController {
  constructor(private readonly hiveidTournamentService: HiveIDTournamentService) {}

  /**
   * GET /auth/hiveid/me/participations — every tournament where the caller has
   * been claimed as a Participant via the CANONICAL_PERSON organisationId.
   */
  @Audience(['hiveid'])
  @Get('me/participations')
  @HttpCode(HttpStatus.OK)
  getMyParticipations(@Req() req: any) {
    return this.hiveidTournamentService.getMyParticipations(req?.user?.userId);
  }

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
