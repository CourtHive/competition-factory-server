import { ApiProperty } from '@nestjs/swagger';

export class GetTournamentMatchUpsDto {
  @ApiProperty()
  params: { tournamentId?: string; [key: string]: any } = {};
}
