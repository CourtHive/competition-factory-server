import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { CHAT_STORAGE, type IChatStorage } from 'src/storage/interfaces';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const PRUNE_INTERVAL_MS = ONE_DAY_MS;

/**
 * Periodically prunes chat messages older than the retention window. Kept as a
 * plain interval (no @nestjs/schedule dependency). The backfill window (24h)
 * is intentionally shorter than retention so a client returning after a longer
 * absence can still gap-fill what it missed.
 */
@Injectable()
export class ChatRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatRetentionService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(@Inject(CHAT_STORAGE) private readonly chatStorage: IChatStorage) {}

  private get retentionMs(): number {
    const days = Number(process.env.CHAT_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
    return days * ONE_DAY_MS;
  }

  onModuleInit(): void {
    // Run once at startup, then daily. `unref()` so the timer never holds the
    // process (or a Jest worker) open.
    void this.prune();
    this.timer = setInterval(() => void this.prune(), PRUNE_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async prune(): Promise<void> {
    const { deleted, error } = await this.chatStorage.pruneOlderThan({ olderThanMs: this.retentionMs });
    if (error) {
      this.logger.warn(`chat retention prune failed: ${error}`);
    } else if (deleted) {
      this.logger.log(`chat retention pruned ${deleted} message(s) older than ${this.retentionMs}ms`);
    }
  }
}
