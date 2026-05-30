import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HiveIDFederationIdDto {
  @ApiProperty({ description: 'Provider key, e.g. "USTA", "ITA", "HTS".' })
  provider: string = '';

  @ApiProperty({ description: 'Stable per-provider identifier (often a numeric id or UUID).' })
  externalId: string = '';
}

export class HiveIDSignupDto {
  @ApiProperty()
  email: string = '';

  @ApiProperty()
  firstName: string = '';

  @ApiProperty()
  lastName: string = '';

  @ApiPropertyOptional({
    description:
      'Pre-existing federation identifiers contributed by the signup form. Forwarded to courthive-persons /persons/resolve for strong-match auto-link.',
    type: [HiveIDFederationIdDto],
  })
  federationIds?: HiveIDFederationIdDto[];
}
