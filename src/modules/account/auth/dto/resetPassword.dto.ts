import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Signed JWT carrying purpose: "password-reset" (issued by /auth/forgot-password).' })
  token: string = '';

  @ApiProperty({ description: 'New cleartext password. Minimum 8 chars enforced on the client; service hashes via bcrypt.' })
  newPassword: string = '';
}
