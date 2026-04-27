import { BroadcastModule } from '../broadcast/broadcast.module';
import { AssignmentsService } from '../../factory/assignments.service';
import { UsersModule } from '../../users/users.module';
import { AdminPresenceController } from './admin-presence.controller';
import { TmxGateway } from './tmx.gateway';
import { Module } from '@nestjs/common';

// AssignmentsService is provided directly here (not via FactoryModule import)
// to avoid a circular dependency: MessagingModule↔FactoryModule.
// Its own DI deps (ASSIGNMENT_STORAGE, USER_PROVIDER_STORAGE, USER_STORAGE)
// come from StorageModule which is @Global.
@Module({
  imports: [BroadcastModule, UsersModule],
  controllers: [AdminPresenceController],
  providers: [TmxGateway, AssignmentsService],
})
export class TmxModule {}
