import { ApiProperty } from '@nestjs/swagger';

export class RemoveDto {
  @ApiProperty()
  email: string = '';
}
