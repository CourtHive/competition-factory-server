import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApplyRegistrationDto {
  @ApiProperty()
  tournamentId: string = '';

  @ApiPropertyOptional({ description: 'Subset of eventIds the applicant wants to enter.' })
  eventIds?: string[];

  @ApiPropertyOptional({ description: 'For doubles: the partner HiveID user_id, when known at submit time.' })
  partnerUserId?: string | null;

  @ApiPropertyOptional({
    description: 'Free-form question answers keyed by RegistrationProfile question id.',
  })
  answers?: Record<string, unknown>;
}
