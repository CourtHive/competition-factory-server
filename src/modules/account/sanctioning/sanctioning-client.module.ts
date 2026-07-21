import { Module } from '@nestjs/common';

import { SanctioningClient } from './sanctioning-client.service';

/**
 * SanctioningClientModule — owns the in-process client for courthive-ams's
 * sanctioning service. CFS calls it (service-token) to lazy-activate a
 * tournamentRecord from an approved proposal on the first accept. Sibling to the
 * declarations/persons clients under the account tree; no other dependencies.
 */
@Module({
  providers: [SanctioningClient],
  exports: [SanctioningClient],
})
export class SanctioningClientModule {}
