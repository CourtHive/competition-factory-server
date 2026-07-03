import { ApiProperty } from '@nestjs/swagger';

export class ApplyPrivacyPolicyDto {
  @ApiProperty({ description: 'Provider whose participant-privacy policy is applied to its existing tournaments.' })
  providerId!: string;

  @ApiProperty({
    required: false,
    description: 'Also apply to in-progress tournaments. Completed tournaments are never touched.',
  })
  includeInProgress?: boolean;
}
