import { ServicesController } from './services.controller';
import { Services } from './services.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [ServicesController],
  providers: [Services],
  exports: [Services],
})
export class ServicesModule {}
