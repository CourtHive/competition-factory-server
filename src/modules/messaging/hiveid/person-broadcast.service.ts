import { REALTIME_PUBLISHER } from '../realtime/realtime.types';
import { personChannel } from '../realtime/channels';
import { Inject, Injectable } from '@nestjs/common';

import type { RealtimePublisher } from '../realtime/realtime.types';

/**
 * Publishes person-scoped updates to a HiveID user's own channel. Wired by
 * PersonsClient.handleMerge in Phase 4.0; later phases extend to
 * roster/schedule/result kinds.
 *
 * Lives outside HiveIDGateway so the producer does not depend on the
 * Socket.IO gateway. An unbound namespace is surfaced by the publisher
 * (A2, A5), not dropped silently.
 */
@Injectable()
export class PersonBroadcastService {
  constructor(@Inject(REALTIME_PUBLISHER) private readonly publisher: RealtimePublisher) {}

  broadcastPersonUpdate(personId: string, payload: any): void {
    if (!personId || !payload) return;
    this.publisher.publish(personChannel(personId), 'personUpdate', payload);
  }
}
