import { PublicGateway } from './public.gateway';
import { Module } from '@nestjs/common';

@Module({
  providers: [PublicGateway],
  exports: [PublicGateway],
})
export class PublicModule {}
