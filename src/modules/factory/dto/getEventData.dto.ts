import { ApiProperty } from '@nestjs/swagger';

export class GetEventDataDto {
  @ApiProperty()
  hydrateParticipants: boolean = true;

  @ApiProperty()
  tournamentId: string = '';

  @ApiProperty()
  eventId: string = '';
}
