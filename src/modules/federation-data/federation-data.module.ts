import { Module } from '@nestjs/common';

import { CtsAdapter } from 'courthive-ingest';

import { FederationDataController } from './federation-data.controller';
import { FederationDataService } from './federation-data.service';
import { FEDERATION_ADAPTERS } from './FederationDataAdapter';

// Federation-data adapters live in `courthive-ingest` and are NestJS-
// agnostic plain classes. We register them here via `useFactory` so DI
// keeps a single instance without the courthive-ingest package needing
// any `@Injectable()` decorators.
//
// Adding a new federation:
//   1. Build the adapter in `courthive-ingest/src/adapters/<provider>/`
//      and export it from courthive-ingest's main entry.
//   2. Add a `{ provide: <Adapter>, useFactory: () => new <Adapter>() }`
//      entry below, plus the class to the FEDERATION_ADAPTERS factory's
//      `inject`/return list.
// No dispatcher edits required.

@Module({
  controllers: [FederationDataController],
  providers: [
    FederationDataService,
    { provide: CtsAdapter, useFactory: () => new CtsAdapter() },
    {
      provide: FEDERATION_ADAPTERS,
      useFactory: (cts: CtsAdapter) => [cts],
      inject: [CtsAdapter],
    },
  ],
  exports: [FederationDataService],
})
export class FederationDataModule {}
