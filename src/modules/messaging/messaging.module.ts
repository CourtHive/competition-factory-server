import { HiveIDMessagingModule } from './hiveid/hiveid.module';
import { PublicModule } from './public/public.module';
import { TmxModule } from './tmx/tmx.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [TmxModule, PublicModule, HiveIDMessagingModule],
})
export class MessagingModule {}
