import { SupportAdminController, SupportCapabilityController, SupportController } from './support.controller';
import { SupportTransport } from './support.transport';
import { SupportService } from './support.service';
import { SupportWorker } from './support.worker';
import { SupportStore } from './support.store';
import { Module } from '@nestjs/common';

@Module({
  controllers: [SupportController, SupportCapabilityController, SupportAdminController],
  providers: [SupportService, SupportStore, SupportWorker, SupportTransport],
})
export class SupportModule {}
