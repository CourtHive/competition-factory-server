import { PublicModule } from './public/public.module';
import { TmxModule } from './tmx/tmx.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [TmxModule, PublicModule],
})
export class MessagingModule {}
