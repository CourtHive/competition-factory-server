import { ApiProperty } from '@nestjs/swagger';

export class SetContactEmailDto {
  @ApiProperty({ description: 'Verified mailbox to send password-recovery and account notices to.' })
  contactEmail: string = '';
}
