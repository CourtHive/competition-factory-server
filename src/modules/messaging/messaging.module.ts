import { TmxModule } from './tmx/tmx.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [TmxModule],
})
export class MessagingModule {}
