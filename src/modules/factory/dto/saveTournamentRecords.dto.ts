import { ApiPropertyOptional } from '@nestjs/swagger';

export class SaveTournamentRecordsDto {
  @ApiPropertyOptional()
  tournamentRecords?: any;

  @ApiPropertyOptional()
  tournamentRecord?: any;

  @ApiPropertyOptional({ description: 'Validation level: "deep" for L3, omit for L2 default' })
  validate?: string;
}
