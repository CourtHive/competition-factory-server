import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ConsumerRegistryService } from './consumer-registry.service';
import { PublicGateway } from 'src/modules/messaging/public/public.gateway';
import { PublicLivePayload } from './types/public-live-payload';

/**
 * Bridge between the projector module and PublicGateway.
 *
 * Registers itself as a callback-style consumer in ConsumerRegistryService
 * on module init. When the projector dispatches a PublicLivePayload, the
 * registered callback runs in-process and emits via PublicGateway to all
 * subscribers in the `public:tournament:{tournamentId}` room.
 *
 * This is the in-process counterpart to the HTTP-dispatch consumers
 * (Expression scorebug, video-board renderer) — same pluggable
 * registration model, no HTTP self-loop.
 */
@Injectable()
export class PublicLiveBroadcaster implements OnModuleInit {
  private readonly logger = new Logger(PublicLiveBroadcaster.name);

  constructor(
    private readonly registry: ConsumerRegistryService,
    private readonly publicGateway: PublicGateway,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      id: 'public-live-broadcaster',
      kind: 'public-live',
      enabled: true,
      callback: (payload) => this.handlePayload(payload as PublicLivePayload),
    });
  }

  private handlePayload(payload: PublicLivePayload): void {
    if (!payload?.tournamentId) {
      this.logger.warn('public-live payload missing tournamentId — skipping broadcast');
      return;
    }
    this.publicGateway.broadcastLiveScore(payload.tournamentId, payload);
  }
}
