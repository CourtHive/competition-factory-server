import { TrackerGateway } from './tracker.gateway';
import { Module } from '@nestjs/common';

@Module({
  providers: [TrackerGateway],
})
export class TrackerModule {}
