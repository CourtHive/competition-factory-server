import { TrackerModule } from './tracker/tracker.module';
import { TmxModule } from './tmx/tmx.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [TrackerModule, TmxModule],
})
export class MessagingModule {}
