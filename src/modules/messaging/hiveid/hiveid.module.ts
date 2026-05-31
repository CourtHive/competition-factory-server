import { HiveIDGateway } from './hiveid.gateway';
import { Module } from '@nestjs/common';

@Module({
  providers: [HiveIDGateway],
  exports: [HiveIDGateway],
})
export class HiveIDMessagingModule {}
