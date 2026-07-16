import { Module } from '@nestjs/common';

import { AdminAvailabilityController } from './admin-availability.controller';
import { AuditModule } from '../../audit/audit.module';
import { AvailabilityPullService } from './availability-pull.service';
import { DeclarationsClient } from './declarations-client.service';
import { FactoryModule } from '../../factory/factory.module';

@Module({
  imports: [FactoryModule, AuditModule],
  controllers: [AdminAvailabilityController],
  providers: [AvailabilityPullService, DeclarationsClient],
  exports: [AvailabilityPullService, DeclarationsClient],
})
export class DeclarationsModule {}
