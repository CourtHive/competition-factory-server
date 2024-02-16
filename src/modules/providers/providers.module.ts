import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [ProvidersController],
  providers: [ProvidersService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
