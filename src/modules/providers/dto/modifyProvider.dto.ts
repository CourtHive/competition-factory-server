import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ModifyProviderDto {
  @ApiProperty()
  organisationName: string = '';

  @ApiPropertyOptional()
  onlineResources?: any;

  @ApiPropertyOptional()
  inactive?: boolean;
}
