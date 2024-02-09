import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetMatchUpsDto {
  @ApiProperty()
  tournamentId: string = '';

  @ApiPropertyOptional()
  eventId?: string;

  @ApiPropertyOptional()
  drawId?: string;

  @ApiPropertyOptional()
  matchUpStatuses?: string[];
}
