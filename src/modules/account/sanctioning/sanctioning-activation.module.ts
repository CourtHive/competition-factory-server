import { Module } from '@nestjs/common';

import { SanctioningActivationService } from './sanctioning-activation.service';
import { AdminSanctioningController } from './admin-sanctioning.controller';
import { SanctioningClientModule } from './sanctioning-client.module';

/**
 * SanctioningActivationModule — the provider administrator's activation of an APPROVED sanctioning record from the
 * AMS console. The first accepted registration activates through RegistrationsModule; both share
 * `sanctioning-activation.ts`.
 */
@Module({
  imports: [SanctioningClientModule],
  controllers: [AdminSanctioningController],
  providers: [SanctioningActivationService],
})
export class SanctioningActivationModule {}
