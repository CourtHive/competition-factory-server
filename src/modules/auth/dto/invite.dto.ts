import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class inviteDto {
  @ApiProperty()
  email: string = '';

  @ApiProperty()
  providerId: string = '';

  @ApiPropertyOptional()
  permissions?: string[];

  @ApiPropertyOptional()
  roles?: string[];
}
