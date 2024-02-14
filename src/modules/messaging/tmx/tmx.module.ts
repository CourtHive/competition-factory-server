import { TmxGateway } from './tmx.gateway';
import { Module } from '@nestjs/common';

@Module({
  providers: [TmxGateway],
})
export class TmxModule {}
