import { ApiProperty } from '@nestjs/swagger';

export class BackfillPrivacyPinsDto {
  @ApiProperty({ description: 'Provider whose tournaments without an attached participant-privacy policy are pinned.' })
  providerId!: string;

  @ApiProperty({
    required: false,
    description: 'Report what would be pinned without writing anything. Defaults to true: a real run must say so.',
  })
  dryRun?: boolean;
}
