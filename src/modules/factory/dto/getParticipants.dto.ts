import { ApiProperty } from '@nestjs/swagger';

export class GetParticipantsDto {
  @ApiProperty()
  params: { tournamentId?: string; [key: string]: any } = {};
}
