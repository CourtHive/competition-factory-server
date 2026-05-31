import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminRegistrationActionDto {
  @ApiPropertyOptional({ description: 'Optional director-side reason recorded on the entry.' })
  statusReason?: string;
}

export class AdminRegistrationBulkDto {
  @ApiProperty({ enum: ['accept', 'waitlist', 'reject'] })
  action: 'accept' | 'waitlist' | 'reject' = 'accept';

  @ApiProperty({ type: [String] })
  registrationIds: string[] = [];

  @ApiPropertyOptional()
  statusReason?: string;
}
