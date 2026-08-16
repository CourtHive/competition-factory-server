import { Global, Module } from '@nestjs/common';

import { MutationServicesService } from './mutation-services.service';

/**
 * Global so both mutation entry points — the Socket.IO gateway (MessagingModule)
 * and FactoryService (FactoryModule) — can inject the single services-bag
 * builder without either module having to import the other.
 *
 * That reachability was the practical reason the bag diverged in the first
 * place: the two call sites live in modules with no relationship, so each grew
 * its own literal. See mutation-services.service.ts for the full history.
 */
@Global()
@Module({
  providers: [MutationServicesService],
  exports: [MutationServicesService],
})
export class MutationServicesModule {}
