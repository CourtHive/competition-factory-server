import { Module } from '@nestjs/common';

import { AdminRegistrationsController } from './admin-registrations.controller';
import { AuditModule } from '../../audit/audit.module';
import { FactoryModule } from '../../factory/factory.module';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

@Module({
  imports: [FactoryModule, AuditModule],
  controllers: [RegistrationsController, AdminRegistrationsController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
