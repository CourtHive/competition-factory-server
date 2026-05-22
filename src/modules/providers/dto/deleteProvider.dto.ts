import { ApiProperty } from '@nestjs/swagger';

export class DeleteProviderDto {
  @ApiProperty({
    description:
      'Must equal the provider\'s organisationAbbreviation. Mismatched value rejects with 400.',
  })
  confirm: string = '';

  @ApiProperty({
    description:
      'Must be literally `true`. Delete is irrevocable — no archive directory, no provider_archives row, no revive path. If you want recoverability, use POST /provider/:id/archive instead.',
  })
  acknowledgeDataLoss: boolean = false;
}
