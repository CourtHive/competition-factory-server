import { DynamicModule, Module, Provider, Type } from '@nestjs/common';

import { CloudIngestController } from './cloud-ingest.controller';
import { OutboundQueueService } from './outbound-queue.service';
import { RelayConfig, resolveInstanceRole } from './relay.config';
import { SenderService } from './sender.service';

/**
 * NOTE: this module is NOT currently imported by `app.module.ts`, so nothing here
 * loads in any deployment. Recorded as D1 in
 * `Mentat/planning/SITE_SERVER_LAN_RESILIENCE.md`; the decision to wire it or
 * delete it is deliberately out of scope for the role-default fix.
 */
@Module({})
export class RelayModule {
  static forRoot(): DynamicModule {
    const isCloud = resolveInstanceRole() === 'cloud';

    const providers: Provider[] = [RelayConfig];
    const exports: Provider[] = [RelayConfig];
    const controllers: Type<unknown>[] = [];

    if (isCloud) {
      controllers.push(CloudIngestController);
    } else {
      providers.push(OutboundQueueService, SenderService);
      exports.push(OutboundQueueService);
    }

    return {
      module: RelayModule,
      providers,
      controllers,
      exports,
    };
  }
}
