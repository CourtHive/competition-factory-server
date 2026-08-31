import { Module } from '@nestjs/common';

import { ParticipationController } from './participation.controller';
import { ParticipationService } from './participation.service';

@Module({
  controllers: [ParticipationController],
  providers: [ParticipationService],
  exports: [ParticipationService],
})
export class ParticipationModule {}
