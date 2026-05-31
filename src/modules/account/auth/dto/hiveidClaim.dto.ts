import { ApiProperty } from '@nestjs/swagger';

export class HiveIDClaimDto {
  @ApiProperty()
  tournamentId: string = '';

  @ApiProperty()
  participantId: string = '';
}
