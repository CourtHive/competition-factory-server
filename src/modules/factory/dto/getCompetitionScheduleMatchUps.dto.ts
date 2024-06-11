import { ApiProperty } from '@nestjs/swagger';

export class GetScheduledMatchUpsDto {
  @ApiProperty()
  params: { hydrateParticipants?: boolean; tournamentId?: string; [key: string]: any } = {};
}
