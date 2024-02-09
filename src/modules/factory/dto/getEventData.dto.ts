import { ApiProperty } from '@nestjs/swagger';

export class GetEventDataDto {
  @ApiProperty()
  tournamentId: string = '';

  @ApiProperty()
  eventId: string = '';
}
