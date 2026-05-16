import { Module } from '@nestjs/common';

import { FederationDataController } from './federation-data.controller';
import { FederationDataService } from './federation-data.service';
import { FEDERATION_ADAPTERS } from './FederationDataAdapter';
import { CtsAdapter } from './adapters/cts/ctsAdapter';

// Adapter registration list. Add a new federation by:
//   1. drop a folder under `adapters/<provider>/`
//   2. implement `FederationDataAdapter`
//   3. add the @Injectable() class to `providers` and to the
//      FEDERATION_ADAPTERS factory's `inject`/return list.
// No dispatcher edits required.

@Module({
  controllers: [FederationDataController],
  providers: [
    FederationDataService,
    CtsAdapter,
    {
      provide: FEDERATION_ADAPTERS,
      useFactory: (cts: CtsAdapter) => [cts],
      inject: [CtsAdapter],
    },
  ],
  exports: [FederationDataService],
})
export class FederationDataModule {}
