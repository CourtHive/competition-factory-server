import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddProviderDto {
  @ApiPropertyOptional()
  teamColors?: unknown;

  @ApiProperty()
  organisationAbbreviation: string = '';

  @ApiProperty()
  organisationName: string = '';

  @ApiPropertyOptional()
  onlineResources: any;
}
