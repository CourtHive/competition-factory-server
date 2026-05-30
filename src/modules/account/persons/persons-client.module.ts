import { Module } from '@nestjs/common';

import { PersonsClient } from './persons-client.service';

/**
 * PersonsClientModule — owns the in-process client for the
 * courthive-persons microservice. The service runs an SSE consumer for
 * personMerged events and exposes thin HTTP wrappers for resolve +
 * getById. Sibling to auth/email/identity under AccountModule (and lifts
 * out with the rest of the account tree per ACCOUNT_SERVICE_BOUNDARY.md).
 *
 * USER_STORAGE is provided by the @Global StorageModule — no import
 * needed here.
 */
@Module({
  providers: [PersonsClient],
  exports: [PersonsClient],
})
export class PersonsClientModule {}
