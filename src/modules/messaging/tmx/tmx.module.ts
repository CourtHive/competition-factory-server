import { BroadcastModule } from '../broadcast/broadcast.module';
import { TmxGateway } from './tmx.gateway';
import { Module } from '@nestjs/common';

@Module({
  imports: [BroadcastModule],
  providers: [TmxGateway],
})
export class TmxModule {}
