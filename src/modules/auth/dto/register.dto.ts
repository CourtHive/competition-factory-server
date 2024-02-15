import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty()
  code: string = '';

  @ApiProperty()
  email: string = '';

  @ApiProperty()
  password: string = '';

  @ApiPropertyOptional()
  firstName?: string;

  @ApiPropertyOptional()
  lastName?: string;
}
