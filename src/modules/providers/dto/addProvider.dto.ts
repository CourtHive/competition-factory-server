import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddProviderDto {
  @ApiProperty()
  organisationAbbreviation: string = '';

  @ApiProperty()
  organisationName: string = '';

  @ApiPropertyOptional()
  onlineResources: any;
}
