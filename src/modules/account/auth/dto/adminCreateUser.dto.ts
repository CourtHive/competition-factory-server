import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminCreateUserDto {
  @ApiProperty()
  email: string = '';

  @ApiPropertyOptional({ description: 'If omitted, server generates a 12-char password and returns it once.' })
  password?: string;

  @ApiPropertyOptional({ description: 'Required for non-SUPER_ADMIN editors. Scope-checked via assertProviderEditor.' })
  providerId?: string;

  @ApiPropertyOptional({ description: 'PROVIDER_ADMIN or DIRECTOR. Defaults to DIRECTOR.' })
  providerRole?: string;

  @ApiPropertyOptional()
  firstName?: string;

  @ApiPropertyOptional()
  lastName?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional()
  roles?: string[];

  @ApiPropertyOptional()
  permissions?: string[];

  @ApiPropertyOptional()
  services?: string[];
}
