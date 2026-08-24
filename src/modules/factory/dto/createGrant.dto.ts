import { ApiProperty } from '@nestjs/swagger';

import type { GrantScope } from '../helpers/grantScope';

export class CreateGrantDto {
  @ApiProperty({ description: 'Tournament the grant applies to. Its record names the owning provider.' })
  tournamentId!: string;

  @ApiProperty({ description: 'Grantee, by login email. Must already be associated with the provider.' })
  userEmail!: string;

  @ApiProperty({
    description: 'A ProviderPermissions key such as "canEnterScores", or "*" for a full grant narrowed only by scope.',
  })
  capability!: string;

  @ApiProperty({
    required: false,
    description:
      'Permitted values per dimension, using the factory filterMatchUps vocabulary: eventIds, drawIds, ' +
      'structureIds, venueIds, courtIds, scheduledDates, matchUpIds. Omit (or {}) for tournament-wide.',
    example: { courtIds: ['court-7'], scheduledDates: ['2026-08-29'] },
  })
  scope?: GrantScope;

  @ApiProperty({ required: false, description: 'ISO instant before which the grant is not yet live.' })
  notBefore?: string | null;

  @ApiProperty({
    required: false,
    description: 'ISO instant after which the grant stops applying. Delivery roles are shift-based — set it.',
  })
  notAfter?: string | null;
}

export class ListGrantsDto {
  @ApiProperty({ description: 'Tournament whose grants are listed.' })
  tournamentId!: string;
}
