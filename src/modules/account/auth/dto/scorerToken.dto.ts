import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for POST /auth/scorer-token. The caller presents their HiveID session
 * (gated by @Audience(['hiveid'])); the identity claims baked into the minted
 * token — personId + email_verified — are read from that session, NEVER from
 * this body. Only the non-identity scoping fields live here.
 */
export class ScorerTokenDto {
  @ApiProperty({ description: 'Tournament the minted score token is scoped to.' })
  tournamentId: string = '';

  @ApiPropertyOptional({
    description:
      'MatchUp the token is scoped to. When present the relay rejects crowd-score ' +
      'submissions for any other matchUp, binding the token to a single match.',
  })
  matchUpId?: string;

  @ApiPropertyOptional({
    description: 'Cosmetic display name for crowd-score attribution. Never a trust gate (verified is).',
  })
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Token lifetime in seconds. Clamped to [60, 14400]. Defaults to 3600 (1h).',
  })
  ttlSeconds?: number;
}
