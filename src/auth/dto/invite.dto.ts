import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class inviteDto {
  @ApiProperty()
  providerId: string = '';

  @ApiProperty()
  email: string = '';

  @ApiPropertyOptional()
  roles?: any;

  @ApiPropertyOptional()
  permissions?: any;
}
