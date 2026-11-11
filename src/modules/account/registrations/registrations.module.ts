import { Module } from '@nestjs/common';

import { SanctioningActivationModule } from '../sanctioning/sanctioning-activation.module';
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
    // The console's activate of an APPROVED record; the first accept activates here. Imported from inside the
    // account tree, so the activation bridge keeps entering through this allowlisted module.
    SanctioningActivationModule,
    BroadcastModule,
  ],
  controllers: [AdminRegistrationsController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
