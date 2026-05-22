import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({
    description:
      'Verified contact email registered with a CourtHive account. Always returns { ok: true } regardless of registration to defeat account enumeration.',
  })
  contactEmail: string = '';
}
