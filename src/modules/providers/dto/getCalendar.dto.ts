import { ApiProperty } from '@nestjs/swagger';

export class GetCalendarDto {
  @ApiProperty()
  providerAbbr: string = '';
}
