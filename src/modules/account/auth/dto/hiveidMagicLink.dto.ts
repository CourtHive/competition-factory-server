import { ApiProperty } from '@nestjs/swagger';

export class HiveIDMagicLinkRequestDto {
  @ApiProperty()
  email: string = '';
}

export class HiveIDMagicLinkConsumeDto {
  @ApiProperty({ description: 'Single-use code from the magic-link email (prefix "hmlk_").' })
  code: string = '';
}
