import { Module } from '@nestjs/common';

import { SanctioningClientModule } from '../sanctioning/sanctioning-client.module';
import { AdminRegistrationsController } from './admin-registrations.controller';
import { BroadcastModule } from '../../messaging/broadcast/broadcast.module';
import { DeclarationsModule } from '../declarations/declarations.module';
import { PersonsClientModule } from '../persons/persons-client.module';
import { RegistrationsService } from './registrations.service';
import { FactoryModule } from '../../factory/factory.module';
import { AuditModule } from '../../audit/audit.module';

@Module({
  imports: [
    FactoryModule,
    AuditModule,
    PersonsClientModule,
    DeclarationsModule,
    SanctioningClientModule,
    BroadcastModule,
  ],
  controllers: [AdminRegistrationsController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
