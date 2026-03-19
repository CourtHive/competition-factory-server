import { PublicModule } from '../public/public.module';
import { TmxGateway } from './tmx.gateway';
import { Module } from '@nestjs/common';

@Module({
  imports: [PublicModule],
  providers: [TmxGateway],
})
export class TmxModule {}
