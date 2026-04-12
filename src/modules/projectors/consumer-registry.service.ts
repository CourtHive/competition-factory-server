import { Injectable, Logger } from '@nestjs/common';

export type ConsumerKind = 'scorebug' | 'video-board' | 'public-live';

/**
 * Two consumer styles:
 *
 * - **HTTP-dispatch** (the original): the projector POSTs the payload to
 *   `url` and treats it as fire-and-forget. Used for Expression scorebug
 *   and the in-arena video-board renderer, which run in separate processes.
 *
 * - **Callback-dispatch** (Phase 1 of courthive-public live viewer): the
 *   projector calls a function reference in-process. Used for the
 *   PublicGateway broadcast, which lives in the same NestJS process as
 *   the projector and shouldn't need an HTTP self-loop.
 *
 * A consumer is one or the other — never both.
 */
export interface HttpConsumerEndpoint {
  id: string;
  kind: ConsumerKind;
  url: string;
  authHeader?: string;
  rateLimitPerSec?: number;
  enabled: boolean;
}

export interface CallbackConsumerEndpoint {
  id: string;
  kind: ConsumerKind;
  /** Marker so the projector knows this is a callback consumer. */
  callback: (payload: unknown) => void | Promise<void>;
  enabled: boolean;
}

export type ConsumerEndpoint = HttpConsumerEndpoint | CallbackConsumerEndpoint;

export function isCallbackConsumer(c: ConsumerEndpoint): c is CallbackConsumerEndpoint {
  return typeof (c as CallbackConsumerEndpoint).callback === 'function';
}

@Injectable()
export class ConsumerRegistryService {
  private readonly logger = new Logger(ConsumerRegistryService.name);
  private readonly endpoints = new Map<string, ConsumerEndpoint>();

  register(endpoint: ConsumerEndpoint): void {
    if (!endpoint?.id) throw new Error('ConsumerEndpoint.id is required');
    this.endpoints.set(endpoint.id, endpoint);
    if (isCallbackConsumer(endpoint)) {
      this.logger.log(`registered ${endpoint.kind} callback consumer ${endpoint.id}`);
    } else {
      this.logger.log(`registered ${endpoint.kind} consumer ${endpoint.id} -> ${endpoint.url}`);
    }
  }

  unregister(id: string): void {
    if (this.endpoints.delete(id)) {
      this.logger.log(`unregistered consumer ${id}`);
    }
  }

  list(kind?: ConsumerKind): ConsumerEndpoint[] {
    const all = Array.from(this.endpoints.values());
    return kind ? all.filter((e) => e.kind === kind) : all;
  }
}
