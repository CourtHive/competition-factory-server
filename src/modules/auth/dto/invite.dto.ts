import { ApiProperty } from '@nestjs/swagger';

export class inviteDto {
  @ApiProperty()
  email: string = '';

  @ApiProperty()
  providerId: string = '';
}
