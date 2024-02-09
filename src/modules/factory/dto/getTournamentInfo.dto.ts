import { ApiProperty } from '@nestjs/swagger';

export class GetTournamentInfoDto {
  @ApiProperty()
  tournamentId: string = '';
}
