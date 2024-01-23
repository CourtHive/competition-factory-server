import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConvertTournamentDto {
  @ApiPropertyOptional()
  context?: any;

  @ApiProperty()
  tournament: any;
}
