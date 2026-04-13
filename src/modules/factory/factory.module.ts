import { BroadcastModule } from '../messaging/broadcast/broadcast.module';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { FactoryController } from './factory.controller';
import { ConfigsModule } from 'src/config/config.module';
import { FactoryService } from './factory.service';
import { ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';

@Module({
  providers: [FactoryService, AssignmentsService, ConfigService],
  controllers: [FactoryController, AssignmentsController],
  exports: [FactoryService, AssignmentsService],
  imports: [ConfigsModule, BroadcastModule],
})
export class FactoryModule {}
