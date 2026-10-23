import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { drawIntegrityMode } from './drawIntegrity';

// constants and types
import { DRAW_INTEGRITY_FINDINGS_STORAGE } from 'src/storage/interfaces/draw-integrity-findings-storage.interface';
import type { DrawIntegrityFindingsSink } from './executionQueueIntegrity';
import type {
  DrawIntegrityFindingRow,
  DrawOpenFindings,
  IDrawIntegrityFindingsStorage,
} from 'src/storage/interfaces/draw-integrity-findings-storage.interface';

/**
 * Rows waiting to be written. Rows arrive only when a draw's finding set CHANGES, so in steady state this holds a
 * handful; the bound is for a database that stays down. Beyond it rows are dropped, counted and logged (A2).
 */
export const MAX_QUEUED_FINDING_ROWS = 5_000;

/** Rows per INSERT: 10 parameters each, well inside Postgres's 65,535-parameter limit. */
export const MAX_FINDING_ROWS_PER_WRITE = 500;

/** A failed write is retried after this long, as well as on the next change recorded. */
export const FINDINGS_RETRY_MS = 30_000;

/** A seed read slower than this is abandoned; the scan falls back to `baseline` for that draw. */
export const SEED_TIMEOUT_MS = 5_000;

const CONTEXT = 'DrawIntegrity';

/** First, then 10, 100, 1000 …, then every 50th — the same throttle as the scan's own failures. */
function shouldLogCount(count: number) {
  if (count === 1) return true;
  if (count % 50 === 0) return true;
  return Number.isInteger(Math.log10(count));
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The executionQueue draw-integrity scan's persistence (migration 056, `draw_integrity_findings`).
 *
 * WRITES ONLY CHANGES. The scan hands over rows only when a draw's finding set changes (`baseline`, `introduced`,
 * `resolved`); a scan that finds what it found last time records nothing.
 *
 * NEVER ON THE REQUEST. `record()` is called from the deferred scan, after the lock is released and the response is
 * sent. It only queues: synchronous, non-throwing, bounded. The write happens on a later turn of the event loop, in
 * batches, one at a time. A failed write keeps its rows (within the bound), is counted and throttled, retried after
 * FINDINGS_RETRY_MS, and its recovery is logged (A2). Nothing here can reach a mutation's outcome.
 *
 * A4: the queue is in memory. A graceful shutdown flushes it; a crash loses what was queued. The cost is a finding
 * whose row was lost: after the restart it is either a `baseline` again (the draw had no other row) or `introduced`
 * again — one duplicate row, and one duplicate alert.
 *
 * `DRAW_INTEGRITY_MODE=off` writes nothing (the scan does not run either).
 */
@Injectable()
export class DrawIntegrityFindingsService implements DrawIntegrityFindingsSink, OnModuleDestroy {
  private queue: DrawIntegrityFindingRow[] = [];
  private flushing: Promise<void> | undefined;
  private flushScheduled = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private failingSince = 0;
  private readonly stats = { recorded: 0, written: 0, dropped: 0, writeFailures: 0 };

  constructor(@Inject(DRAW_INTEGRITY_FINDINGS_STORAGE) private readonly storage: IDrawIntegrityFindingsStorage) {}

  async onModuleDestroy() {
    this.destroyed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    await this.flush();
  }

  record(rows: DrawIntegrityFindingRow[]): void {
    try {
      if (!rows?.length || drawIntegrityMode() === 'off') return;
      const room = Math.max(MAX_QUEUED_FINDING_ROWS - this.queue.length, 0);
      const accepted = rows.slice(0, room);
      if (accepted.length < rows.length) this.recordDropped(rows.length - accepted.length);
      if (!accepted.length) return;
      this.queue.push(...accepted);
      this.stats.recorded += accepted.length;
      this.scheduleFlush();
    } catch (err: any) {
      Logger.warn(
        JSON.stringify({ event: 'draw-integrity-findings-record-failed', message: err?.message ?? String(err) }),
        CONTEXT,
      );
    }
  }

  /**
   * The draw's open set as persisted. Flushes this process's queue first, so a draw read back after an eviction sees
   * the rows this process already recorded for it. Bounded by SEED_TIMEOUT_MS; rejects on failure (the caller counts).
   */
  async loadOpen(tournamentId: string, drawId: string): Promise<DrawOpenFindings> {
    await this.flush();
    return withTimeout(this.storage.loadOpenFindings(tournamentId, drawId), SEED_TIMEOUT_MS, 'findings seed read');
  }

  /** Write everything queued. Never rejects. Concurrent calls share one drain. */
  flush(): Promise<void> {
    this.flushing ??= this.drain().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  /** Operator- and spec-visible state (A4). */
  getStatus() {
    return { ...this.stats, queued: this.queue.length, failingSince: this.failingSince };
  }

  private scheduleFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setImmediate(() => {
      this.flushScheduled = false;
      this.flush();
    });
  }

  private async drain() {
    while (this.queue.length) {
      const batch = this.queue.splice(0, MAX_FINDING_ROWS_PER_WRITE);
      try {
        await this.storage.append(batch);
      } catch (err: any) {
        // Put the batch back in front, keeping order; rows recorded meanwhile come after it. Over the bound, the
        // newest go: a finding's FIRST row is the one the seed and the alert need.
        this.queue.unshift(...batch);
        const overflow = this.queue.length - MAX_QUEUED_FINDING_ROWS;
        if (overflow > 0) {
          this.queue.length = MAX_QUEUED_FINDING_ROWS;
          this.recordDropped(overflow);
        }
        this.recordWriteFailure(err, batch.length);
        this.scheduleRetry();
        return;
      }
      this.stats.written += batch.length;
      this.recordWriteRecovery();
    }
  }

  private scheduleRetry() {
    if (this.retryTimer || this.destroyed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.flush();
    }, FINDINGS_RETRY_MS);
    this.retryTimer.unref?.();
  }

  private recordWriteFailure(err: any, rows: number) {
    this.stats.writeFailures += 1;
    this.failingSince += 1;
    if (!shouldLogCount(this.stats.writeFailures)) return;
    Logger.warn(
      JSON.stringify({
        event: 'draw-integrity-findings-write-failed',
        writeFailures: this.stats.writeFailures,
        rows,
        queued: this.queue.length,
        message: err?.message ?? String(err),
      }),
      CONTEXT,
    );
  }

  private recordWriteRecovery() {
    if (!this.failingSince) return;
    Logger.warn(
      JSON.stringify({
        event: 'draw-integrity-findings-write-recovered',
        afterFailures: this.failingSince,
        queued: this.queue.length,
      }),
      CONTEXT,
    );
    this.failingSince = 0;
  }

  private recordDropped(count: number) {
    const before = this.stats.dropped;
    const after = before + count;
    this.stats.dropped = after;
    // One call can drop many rows, so log when the running total CROSSES a throttle mark (first, a power of ten, a
    // multiple of 50), not when it happens to land on one.
    const crossed =
      before === 0 ||
      Math.floor(after / 50) > Math.floor(before / 50) ||
      Math.floor(Math.log10(after)) > Math.floor(Math.log10(before));
    if (!crossed) return;
    Logger.warn(
      JSON.stringify({
        event: 'draw-integrity-findings-dropped',
        dropped: this.stats.dropped,
        queueLimit: MAX_QUEUED_FINDING_ROWS,
      }),
      CONTEXT,
    );
  }
}
