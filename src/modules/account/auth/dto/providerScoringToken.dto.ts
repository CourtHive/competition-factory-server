import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProviderScoringTokenDto {
  @ApiProperty({ description: 'Tournament the minted token will be scoped to.' })
  tournamentId: string = '';

  @ApiProperty({ description: 'Canonical Person id of the scorer the provider is attesting.' })
  personId: string = '';

  @ApiPropertyOptional({ description: 'Cached display name for the scorer.' })
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Provider attestation that the scorer is verified. Gates TMX scorer-nomination.',
  })
  verified?: boolean;

  @ApiPropertyOptional({
    description: 'Token lifetime in seconds. Clamped to [60, 28800]. Defaults to 3600 (1h).',
  })
  ttlSeconds?: number;
}
