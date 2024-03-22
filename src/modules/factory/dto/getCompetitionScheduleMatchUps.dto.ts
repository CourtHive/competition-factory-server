import { ApiProperty } from '@nestjs/swagger';

export class GetScheduledMatchUpsDto {
  @ApiProperty()
  params: { tournamentId?: string; [key: string]: any } = {};
}
