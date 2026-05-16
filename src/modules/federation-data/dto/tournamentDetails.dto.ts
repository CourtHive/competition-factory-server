import { ApiProperty } from '@nestjs/swagger';

export class tournamentDetailsDto {
  @ApiProperty()
  identifier: string = '';
}
