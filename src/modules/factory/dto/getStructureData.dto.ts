import { ApiProperty } from '@nestjs/swagger';

export class GetStructureDataDto {
  @ApiProperty()
  tournamentId: string = '';

  @ApiProperty()
  drawId: string = '';

  @ApiProperty()
  structureId: string = '';
}
