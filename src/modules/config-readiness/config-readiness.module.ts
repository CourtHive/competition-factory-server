import { Module } from '@nestjs/common';

import { ConfigReadinessController } from './config-readiness.controller';
import { ConfigReadinessService } from './config-readiness.service';

@Module({
  providers: [ConfigReadinessService],
  controllers: [ConfigReadinessController],
  exports: [ConfigReadinessService],
})
export class ConfigReadinessModule {}
