import { Module } from '@nestjs/common';
import { SanctioningController } from './sanctioning.controller';
import { SanctioningService } from './sanctioning.service';

@Module({
  controllers: [SanctioningController],
  providers: [SanctioningService],
  exports: [SanctioningService],
})
export class SanctioningModule {}
