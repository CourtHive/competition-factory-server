import { ApiPropertyOptional } from '@nestjs/swagger';

export class FetchTournamentUpdatedAtDto {
  @ApiPropertyOptional()
  tournamentId?: string;
}
