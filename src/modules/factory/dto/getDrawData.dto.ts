import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetDrawDataDto {
  @ApiProperty()
  tournamentId: string = '';

  @ApiProperty()
  drawId: string = '';

  /**
   * How much of each structure to return — `'FULL'` (default) or `'STUBS'`.
   * `STUBS` omits roundMatchUps and seedAssignments; see the factory's query-governor docs.
   */
  @ApiPropertyOptional({ enum: ['FULL', 'STUBS'] })
  structuresProfile?: string;
}
