import { ApiProperty } from '@nestjs/swagger';

export class AdminResendVerificationDto {
  @ApiProperty({ description: 'Login email of the target user whose pending contact_email verification should be re-sent.' })
  email: string = '';
}
