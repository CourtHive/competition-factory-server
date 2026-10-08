import { RealtimeModule } from '../realtime/realtime.module';
import { PublicGateway } from './public.gateway';
import { Module } from '@nestjs/common';

@Module({
  imports: [RealtimeModule],
  providers: [PublicGateway],
  exports: [PublicGateway],
})
export class PublicModule {}
