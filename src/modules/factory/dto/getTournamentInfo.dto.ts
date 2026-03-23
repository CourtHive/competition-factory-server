import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetTournamentInfoDto {
  @ApiProperty()
  tournamentId: string = '';

  @ApiPropertyOptional()
  withMatchUpStats?: boolean;

  @ApiPropertyOptional()
  withStructureDetails?: boolean;

  @ApiPropertyOptional()
  usePublishState?: boolean;

  @ApiPropertyOptional()
  withVenueData?: boolean;
}
