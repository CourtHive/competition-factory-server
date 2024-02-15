import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InviteDto {
  @ApiProperty()
  email: string = '';

  @ApiProperty()
  providerId: string = '';

  @ApiPropertyOptional()
  permissions?: string[];

  @ApiPropertyOptional()
  roles?: string[];
}
