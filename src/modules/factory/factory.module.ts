import { FactoryController } from './factory.controller';
import { FactoryService } from './factory.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [FactoryController],
  providers: [FactoryService],
  exports: [FactoryService],
})
export class FactoryModule {}
