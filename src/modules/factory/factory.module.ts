import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import { ProjectionRebuildService } from './projection/projection-rebuild.service';
import { AdminProjectionController } from './admin-projection.controller';
import { BroadcastModule } from '../messaging/broadcast/broadcast.module';
import { AssignmentsController } from './assignments.controller';
import { MutationAuthorizationService } from './mutation-authorization.service';
import { AssignmentsService } from './assignments.service';
import { GrantsService } from './grants.service';
import { FactoryController } from './factory.controller';
import { AuditModule } from '../audit/audit.module';
import { ConfigsModule } from 'src/config/config.module';
import { FactoryService } from './factory.service';
import { ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';

@Module({
  providers: [
    FactoryService,
    AssignmentsService,
    MutationAuthorizationService,
    GrantsService,
    ConfigService,
    ProjectionRebuildService,
    SnapshotProjectionService,
  ],
  controllers: [FactoryController, AssignmentsController, AdminProjectionController],
  exports: [FactoryService, AssignmentsService, MutationAuthorizationService, GrantsService, ProjectionRebuildService, SnapshotProjectionService],
  imports: [ConfigsModule, BroadcastModule, AuditModule],
})
export class FactoryModule {}
