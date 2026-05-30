import { ApiProperty } from '@nestjs/swagger';

export class HiveIDVerifyExistingDto {
  @ApiProperty()
  email: string = '';

  @ApiProperty()
  password: string = '';
}
