import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import {
  ConsumerEndpoint,
  ConsumerRegistryService,
  HttpConsumerEndpoint,
  isCallbackConsumer,
} from './consumer-registry.service';
import { BoltHistoryDocument } from './types/bolt-history-document';
import { ScorebugClockTick } from './types/scorebug-clock-tick';

const DEFAULT_TICK_INTERVAL_MS = 250;
const MAX_TICK_INTERVAL_MS = 5000;
const MIN_TICK_INTERVAL_MS = 50;

interface TickerState {
  document: BoltHistoryDocument;
  intervalHandle: ReturnType<typeof setInterval>;
  /** Date.now() at the moment we last anchored to this document. */
  anchoredAt: number;
}

/**
 * Per-matchUp sub-second clock tick generator for Expression-style
 * broadcast scorebug consumers.
 *
 * On every projector dispatch (i.e. every successful BoltHistoryService
 * upsert), `notifyDocumentUpdate(document)` is called. The service
 * inspects the document's bolt state:
 *
 * - If running (`boltStarted && !boltExpired && !boltComplete && !pausedOnExit`):
 *   start (or restart with the new clock anchor) a setInterval that
 *   fires every SCOREBUG_TICK_INTERVAL_MS (default 250ms = 4Hz).
 * - Else: clear any existing interval for that matchUpId.
 *
 * On each tick, the service extrapolates the current clock values from
 * the anchored document, builds a `ScorebugClockTick` payload, and
 * dispatches it to all enabled scorebug consumers in the registry.
 * Both HTTP and callback consumers are supported (mirrors the
 * ProjectorService dispatch logic).
 *
 * Tick payloads are inherently disposable: the next tick supersedes
 * any failure, so dispatches use fire-and-forget HTTP POST with NO
 * retry. The dispatch loop logs errors at debug level only — at 4Hz,
 * a noisy logger would dominate the output.
 *
 * The service auto-stops a ticker when extrapolated `boltClockMs <= 0`
 * to avoid emitting an endless stream of zero ticks. The next upsert
 * (which will set `boltExpired: true`) is what permanently retires
 * the ticker.
 */
@Injectable()
export class ScorebugTickService implements OnModuleDestroy {
  private readonly logger = new Logger(ScorebugTickService.name);
  private readonly tickers = new Map<string, TickerState>();
  private readonly tickIntervalMs = this.resolveTickInterval();

  constructor(private readonly registry: ConsumerRegistryService) {}

  onModuleDestroy(): void {
    for (const id of Array.from(this.tickers.keys())) {
      this.stopTicker(id);
    }
  }

  /**
   * Called by ProjectorService.project() after a successful dispatch
   * of the scorebug event payload. Decides whether to start, restart,
   * or stop the per-matchUp clock tick stream based on the document's
   * bolt state.
   */
  notifyDocumentUpdate(document: BoltHistoryDocument): void {
    if (!document?.tieMatchUpId) return;
    const id = document.tieMatchUpId;

    const isRunning =
      Boolean(document.boltStarted) &&
      !document.boltExpired &&
      !document.boltComplete &&
      !document.pausedOnExit;

    if (!isRunning) {
      this.stopTicker(id);
      return;
    }

    // Restart with the new anchor: any existing interval is replaced so
    // the extrapolation runs from the latest persisted clock values.
    this.stopTicker(id);
    const intervalHandle = setInterval(() => this.emitTick(id), this.tickIntervalMs);
    if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
    this.tickers.set(id, {
      document,
      intervalHandle,
      anchoredAt: Date.now(),
    });
  }

  /** Test/inspection helper. */
  getActiveTickerCount(): number {
    return this.tickers.size;
  }

  /** Test/inspection helper. */
  isTicking(matchUpId: string): boolean {
    return this.tickers.has(matchUpId);
  }

  private stopTicker(matchUpId: string): void {
    const ticker = this.tickers.get(matchUpId);
    if (!ticker) return;
    clearInterval(ticker.intervalHandle);
    this.tickers.delete(matchUpId);
  }

  private emitTick(matchUpId: string): void {
    const ticker = this.tickers.get(matchUpId);
    if (!ticker) return;

    const elapsedMs = Date.now() - ticker.anchoredAt;
    const boltClockMs = Math.max(0, (ticker.document.boltClockRemainingMs ?? 0) - elapsedMs);
    const serveClockMs = Math.max(0, (ticker.document.serveClockRemainingMs ?? 0) - elapsedMs);

    const tick: ScorebugClockTick = {
      kind: 'tick',
      matchUpId,
      tournamentId: ticker.document.tournamentId,
      format: 'INTENNSE',
      state: 'play',
      boltClockMs,
      serveClockMs,
      playerClocks: this.buildPlayerClocks(ticker.document, elapsedMs),
      penaltyBox: this.buildPenaltyBox(ticker.document, elapsedMs),
      generatedAt: new Date().toISOString(),
    };

    void this.dispatchTick(tick);

    // Auto-stop on bolt clock exhaustion. The next upsert (which will
    // set boltExpired) is what permanently retires the ticker; this
    // just prevents an endless zero-stream in the gap before that
    // upsert arrives.
    if (boltClockMs <= 0) {
      this.stopTicker(matchUpId);
    }
  }

  private buildPlayerClocks(
    document: BoltHistoryDocument,
    elapsedMs: number,
  ): Record<string, { remainingMs: number; isOnCourt: boolean }> | undefined {
    const snapshots = document.playerTimeSnapshots;
    if (!snapshots || typeof snapshots !== 'object') return undefined;
    const out: Record<string, { remainingMs: number; isOnCourt: boolean }> = {};
    for (const [participantId, snapshot] of Object.entries(snapshots)) {
      // Player clocks count UP, not down — `elapsedMs` here represents
      // additional elapsed time (the bolt clock is running). Only
      // on-court players accrue time.
      const accruedMs = snapshot.isOnCourt ? snapshot.elapsedMs + elapsedMs : snapshot.elapsedMs;
      out[participantId] = { remainingMs: accruedMs, isOnCourt: snapshot.isOnCourt };
    }
    return out;
  }

  private buildPenaltyBox(
    document: BoltHistoryDocument,
    elapsedMs: number,
  ): Record<string, { remainingMs: number; sideNumber: 1 | 2; participantName?: string }> | undefined {
    const snapshots = document.penaltyBoxSnapshots;
    if (!snapshots || typeof snapshots !== 'object') return undefined;
    const out: Record<string, { remainingMs: number; sideNumber: 1 | 2; participantName?: string }> = {};
    let hasEntries = false;
    for (const [participantId, snapshot] of Object.entries(snapshots)) {
      const remainingMs = Math.max(0, snapshot.remainingMs - elapsedMs);
      out[participantId] = {
        remainingMs,
        sideNumber: snapshot.sideNumber,
        participantName: snapshot.participantName,
      };
      hasEntries = true;
    }
    return hasEntries ? out : undefined;
  }

  private async dispatchTick(tick: ScorebugClockTick): Promise<void> {
    const consumers = this.registry.list('scorebug').filter((c) => c.enabled);
    for (const consumer of consumers) {
      void this.dispatchToConsumer(consumer, tick);
    }
  }

  private async dispatchToConsumer(consumer: ConsumerEndpoint, tick: ScorebugClockTick): Promise<void> {
    if (isCallbackConsumer(consumer)) {
      try {
        await consumer.callback(tick);
      } catch (err) {
        // Quiet — ticks are disposable
        this.logger.debug?.(
          `tick callback to ${consumer.id} threw: ${(err as Error)?.message ?? err}`,
        );
      }
      return;
    }
    await this.dispatchHttpTick(consumer, tick);
  }

  private async dispatchHttpTick(consumer: HttpConsumerEndpoint, tick: ScorebugClockTick): Promise<void> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (consumer.authHeader) headers.Authorization = consumer.authHeader;
      const response = await fetch(consumer.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(tick),
      });
      if (!response.ok) {
        // Quiet — ticks are disposable, next tick supersedes
        this.logger.debug?.(`tick HTTP to ${consumer.id} returned ${response.status}`);
      }
    } catch (err) {
      this.logger.debug?.(`tick HTTP to ${consumer.id} failed: ${(err as Error)?.message ?? err}`);
    }
  }

  private resolveTickInterval(): number {
    const raw = Number(process.env.SCOREBUG_TICK_INTERVAL_MS);
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TICK_INTERVAL_MS;
    return Math.min(MAX_TICK_INTERVAL_MS, Math.max(MIN_TICK_INTERVAL_MS, Math.floor(raw)));
  }
}
