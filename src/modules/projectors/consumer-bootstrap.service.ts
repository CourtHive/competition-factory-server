import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ConsumerEndpoint, ConsumerRegistryService } from './consumer-registry.service';

/**
 * On module init, registers any consumer endpoints declared via env vars
 * with the in-memory ConsumerRegistryService.
 *
 * Env vars:
 *   SCORE_RELAY_URL          — base URL of the LAN score-relay (Decision 1 = C)
 *   EXPRESSION_URL           — direct URL of the Expression broadcast scorebug (optional)
 *   VIDEO_BOARD_URL          — direct URL of the in-arena video board renderer (optional)
 *   CLOUD_RELAY_API_KEY      — used as Bearer token for the score-relay route, if set
 *
 * Registration shape: each consumer is registered with `kind: 'scorebug'`
 * and/or `kind: 'video-board'` so the projector dispatches the right
 * payload type to the right endpoint. SCORE_RELAY_URL produces TWO
 * registrations (one per kind) since the relay accepts both projection
 * shapes on dedicated routes.
 */
@Injectable()
export class ConsumerBootstrap implements OnModuleInit {
  private readonly logger = new Logger(ConsumerBootstrap.name);

  constructor(private readonly registry: ConsumerRegistryService) {}

  onModuleInit(): void {
    const registered: ConsumerEndpoint[] = [];

    const scoreRelayUrl = process.env.SCORE_RELAY_URL?.trim();
    if (scoreRelayUrl) {
      const base = scoreRelayUrl.replace(/\/$/, '');
      registered.push(this.registerOne({
        id: 'score-relay-scorebug',
        kind: 'scorebug',
        url: `${base}/api/projection/scorebug`,
        authHeader: process.env.SCORE_RELAY_API_KEY ? `Bearer ${process.env.SCORE_RELAY_API_KEY}` : undefined,
        enabled: true,
      }));
      registered.push(this.registerOne({
        id: 'score-relay-video-board',
        kind: 'video-board',
        url: `${base}/api/projection/video-board`,
        authHeader: process.env.SCORE_RELAY_API_KEY ? `Bearer ${process.env.SCORE_RELAY_API_KEY}` : undefined,
        enabled: true,
      }));
    }

    const expressionUrl = process.env.EXPRESSION_URL?.trim();
    if (expressionUrl) {
      registered.push(this.registerOne({
        id: 'expression-direct',
        kind: 'scorebug',
        url: expressionUrl,
        authHeader: process.env.EXPRESSION_API_KEY ? `Bearer ${process.env.EXPRESSION_API_KEY}` : undefined,
        enabled: true,
      }));
    }

    const videoBoardUrl = process.env.VIDEO_BOARD_URL?.trim();
    if (videoBoardUrl) {
      registered.push(this.registerOne({
        id: 'video-board-direct',
        kind: 'video-board',
        url: videoBoardUrl,
        authHeader: process.env.VIDEO_BOARD_API_KEY ? `Bearer ${process.env.VIDEO_BOARD_API_KEY}` : undefined,
        enabled: true,
      }));
    }

    if (registered.length === 0) {
      this.logger.log('ConsumerBootstrap: no consumer endpoints configured (set SCORE_RELAY_URL / EXPRESSION_URL / VIDEO_BOARD_URL)');
    } else {
      this.logger.log(`ConsumerBootstrap: registered ${registered.length} consumer endpoint(s)`);
    }
  }

  private registerOne(endpoint: ConsumerEndpoint): ConsumerEndpoint {
    this.registry.register(endpoint);
    return endpoint;
  }
}
