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

  @ApiPropertyOptional({
    description:
      'Verified recovery mailbox. Writing a new value clears email_verified_at; the admin (or eventually the user) then triggers a verification mail via POST /auth/send-contact-email-verification. Forgot-password mail targets this address, never `email` (the login id).',
  })
  contactEmail?: string;
}
