import { BroadcastModule } from '../broadcast/broadcast.module';
import { MutationAuthorizationService } from '../../factory/mutation-authorization.service';
import { AssignmentsService } from '../../factory/assignments.service';
import { UsersModule } from '../../users/users.module';
import { AuditModule } from '../../audit/audit.module';
import { AdminPresenceController } from './admin-presence.controller';
import { ChatRetentionService } from './chat-retention.service';
import { TmxGateway } from './tmx.gateway';
import { Module } from '@nestjs/common';

// AssignmentsService and MutationAuthorizationService are provided directly here
// (not via FactoryModule import) to avoid a circular dependency:
// MessagingModule↔FactoryModule.
// Its own DI deps (ASSIGNMENT_STORAGE, USER_PROVIDER_STORAGE, USER_STORAGE)
// come from StorageModule which is @Global.
@Module({
  imports: [BroadcastModule, UsersModule, AuditModule],
  controllers: [AdminPresenceController],
  providers: [TmxGateway, AssignmentsService, MutationAuthorizationService, ChatRetentionService],
})
export class TmxModule {}
