import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetMatchUpStatusDto {
  @ApiProperty()
  tournamentId: string = '';

  @ApiProperty()
  matchUpId: string = '';

  @ApiProperty()
  drawId: string = '';

  @ApiPropertyOptional()
  outcome?: any;

  @ApiPropertyOptional()
  disableAutoCalc?: boolean;

  @ApiPropertyOptional()
  enableAutoCalc?: boolean;

  @ApiPropertyOptional()
  matchUpFormat?: string;

  @ApiPropertyOptional()
  schedule?: any;
}
