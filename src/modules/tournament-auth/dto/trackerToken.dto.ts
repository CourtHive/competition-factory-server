import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TrackerTokenDto {
  @ApiProperty({ description: 'Tournament the minted token will be scoped to.' })
  tournamentId: string = '';

  @ApiPropertyOptional({
    description:
      'Token lifetime in seconds. Clamped to [60, 28800]. Defaults to 3600 (1h). ' +
      'Anything above 28800 (8h) is rejected so a leaked token cannot outlive the daily session.',
  })
  ttlSeconds?: number;
}
