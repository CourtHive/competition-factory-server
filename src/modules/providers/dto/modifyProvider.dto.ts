import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ModifyProviderDto {
  @ApiPropertyOptional()
  teamColors?: unknown;

  @ApiProperty()
  organisationName: string = '';

  @ApiPropertyOptional()
  onlineResources?: any;

  @ApiPropertyOptional()
  inactive?: boolean;
}
