import { Module } from '@nestjs/common';

import { AdminRegistrationsController } from './admin-registrations.controller';
import { PersonsClientModule } from '../persons/persons-client.module';
import { DeclarationsModule } from '../declarations/declarations.module';
import { AuditModule } from '../../audit/audit.module';
import { FactoryModule } from '../../factory/factory.module';
import { RegistrationsService } from './registrations.service';

@Module({
  imports: [FactoryModule, AuditModule, PersonsClientModule, DeclarationsModule],
  controllers: [AdminRegistrationsController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
