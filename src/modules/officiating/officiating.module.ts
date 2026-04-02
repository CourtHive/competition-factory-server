import { OfficiatingController } from './officiating.controller';
import { OfficiatingService } from './officiating.service';
import { Module } from '@nestjs/common';

@Module({
  controllers: [OfficiatingController],
  providers: [OfficiatingService],
  exports: [OfficiatingService],
})
export class OfficiatingModule {}
