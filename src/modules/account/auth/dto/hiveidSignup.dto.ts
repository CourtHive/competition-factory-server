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

  @ApiPropertyOptional({
    description:
      "Date of birth (YYYY-MM-DD), collected behind a consent gate. Enables courthive-persons to dedupe on name+DOB+sex, or MINT a canonical person when no match exists.",
  })
  birthDate?: string;

  @ApiPropertyOptional({
    description: "Sex ('M' | 'F'), collected behind a consent gate. Required (with birthDate) for dedupe/mint.",
  })
  sex?: string;

  @ApiPropertyOptional({
    description:
      "Provider context (the registering tournament's provider, e.g. 'BOBOCA'). A fresh mint is anchored to it via a synthesized provider-scoped id so the person is owned by that tenant.",
  })
  provider?: string;
}
