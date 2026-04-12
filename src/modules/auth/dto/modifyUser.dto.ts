import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ModifyUserDto {
  @ApiProperty()
  email: string = '';

  @ApiPropertyOptional()
  roles?: string[];

  @ApiPropertyOptional()
  firstName?: string;

  @ApiPropertyOptional()
  lastName?: string;

  @ApiPropertyOptional()
  providerId?: string;

  @ApiPropertyOptional()
  permissions?: string[];

  @ApiPropertyOptional()
  services?: string[];
}
