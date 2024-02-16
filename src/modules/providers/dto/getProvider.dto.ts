import { ApiProperty } from '@nestjs/swagger';

export class GetProviderDto {
  @ApiProperty()
  providerId: string = '';
}
