import { PersonBroadcastService } from './person-broadcast.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { HiveIDGateway } from './hiveid.gateway';
import { Module } from '@nestjs/common';

@Module({
  imports: [RealtimeModule],
  providers: [HiveIDGateway, PersonBroadcastService],
  exports: [PersonBroadcastService],
})
export class HiveIDMessagingModule {}
