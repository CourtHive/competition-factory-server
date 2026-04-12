import { DynamicModule, Module, Provider, Type } from '@nestjs/common';

import { CloudIngestController } from './cloud-ingest.controller';
import { OutboundQueueService } from './outbound-queue.service';
import { SenderService } from './sender.service';
import { RelayConfig } from './relay.config';

@Module({})
export class RelayModule {
  static forRoot(): DynamicModule {
    const role = (process.env.INSTANCE_ROLE ?? 'local').toLowerCase();
    const isCloud = role === 'cloud';

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
