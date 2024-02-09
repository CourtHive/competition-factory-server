import { ApiPropertyOptional } from '@nestjs/swagger';

export class SaveTournamentRecordsDto {
  @ApiPropertyOptional()
  tournamentRecords?: any;

  @ApiPropertyOptional()
  tournamentRecord?: any;
}
