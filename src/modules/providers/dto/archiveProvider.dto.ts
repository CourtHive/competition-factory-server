import { ApiProperty } from '@nestjs/swagger';

export class ArchiveProviderDto {
  @ApiProperty({
    description:
      'Must equal the provider\'s organisationAbbreviation. Mismatched value rejects with 400 — defends against accidental archive of the wrong provider.',
  })
  confirm: string = '';
}
