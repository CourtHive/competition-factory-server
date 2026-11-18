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

  @ApiPropertyOptional()
  params?: any;

  /** Stable retry key, scoped to the authenticated actor: a resend returns the original result, never scores twice. */
  @ApiPropertyOptional()
  commandId?: string;

  /** Must match the authenticated email when commandId is set; prevents a queued score crossing account changes. */
  @ApiPropertyOptional()
  commandUser?: string;
}
