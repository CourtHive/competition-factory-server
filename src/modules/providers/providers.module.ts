import { ProvidersService } from './providers.service';
import { Module } from '@nestjs/common';

@Module({
  providers: [ProvidersService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
