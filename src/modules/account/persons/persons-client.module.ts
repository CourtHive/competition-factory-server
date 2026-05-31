import { Module } from '@nestjs/common';

import { HiveIDMessagingModule } from '../../messaging/hiveid/hiveid.module';
import { PersonsClient } from './persons-client.service';

/**
 * PersonsClientModule — owns the in-process client for the
 * courthive-persons microservice. The service runs an SSE consumer for
 * personMerged events and exposes thin HTTP wrappers for resolve +
 * getById. Sibling to auth/email/identity under AccountModule (and lifts
 * out with the rest of the account tree per ACCOUNT_SERVICE_BOUNDARY.md).
 *
 * Imports HiveIDMessagingModule so the SSE consumer can fan
 * personMerged events out to per-person rooms (HiveID Phase 4 MVP).
 * One-way dependency persons → messaging — no cycle.
 *
 * USER_STORAGE is provided by the @Global StorageModule — no import
 * needed here.
 */
@Module({
  imports: [HiveIDMessagingModule],
  providers: [PersonsClient],
  exports: [PersonsClient],
})
export class PersonsClientModule {}
