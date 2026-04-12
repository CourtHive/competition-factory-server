import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { OutboundQueueService } from './outbound-queue.service';
import { QueueEntry } from './types/queue-entry';
import { RelayConfig } from './relay.config';

const MAX_BACKOFF_MS = 60_000;

@Injectable()
export class SenderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SenderService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentBackoff = 0;
  private draining = false;

  constructor(
    private readonly config: RelayConfig,
    private readonly queue: OutboundQueueService,
  ) {}

  onModuleInit(): void {
    if (this.config.role !== 'local') {
      this.logger.log('SenderService disabled (INSTANCE_ROLE != local)');
      return;
    }
    if (!this.config.cloudRelayUrl) {
      this.logger.log('SenderService disabled (CLOUD_RELAY_URL unset)');
      return;
    }
    this.scheduleNext(this.config.drainIntervalMs);
    this.logger.log(
      `SenderService started — venue=${this.config.venueId}, target=${this.config.cloudRelayUrl}`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // Exposed for tests so we don't need to wait for the timer.
  async drainOnce(): Promise<{ sent: number; failed: number }> {
    if (this.draining) return { sent: 0, failed: 0 };
    this.draining = true;
    try {
      const batch = await this.queue.peek(this.config.maxBatchSize);
      if (batch.length === 0) return { sent: 0, failed: 0 };

      try {
        await this.postBatch(batch);
        await this.queue.ack(batch.map((e) => e.sequence));
        this.currentBackoff = 0;
        return { sent: batch.length, failed: 0 };
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        for (const entry of batch) {
          await this.queue.nack(entry.sequence, message);
        }
        this.bumpBackoff();
        this.logger.warn(`drain failed: ${message} — backoff ${this.currentBackoff}ms`);
        return { sent: 0, failed: batch.length };
      }
    } finally {
      this.draining = false;
    }
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(async () => {
      await this.drainOnce();
      const next = this.currentBackoff > 0 ? this.currentBackoff : this.config.drainIntervalMs;
      if (this.timer !== null) this.scheduleNext(next);
    }, delayMs);
    // Avoid keeping the event loop alive in tests / single-shot drains.
    if (this.timer.unref) this.timer.unref();
  }

  private async postBatch(entries: QueueEntry[]): Promise<void> {
    const url = `${this.config.cloudRelayUrl?.replace(/\/$/, '')}/api/cloud-ingest`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.cloudRelayApiKey) {
      headers.Authorization = `Bearer ${this.config.cloudRelayApiKey}`;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ venueId: this.config.venueId, entries }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  }

  private bumpBackoff(): void {
    if (this.currentBackoff === 0) {
      this.currentBackoff = this.config.drainIntervalMs;
    } else {
      this.currentBackoff = Math.min(this.currentBackoff * 2, MAX_BACKOFF_MS);
    }
  }
}
