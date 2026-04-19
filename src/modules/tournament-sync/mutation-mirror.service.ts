import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from 'src/storage/postgres/postgres.config';
import { RelayConfig } from '../relay/relay.config';

const MAX_BACKOFF_MS = 60_000;
const DRAIN_INTERVAL_MS = 3_000;
const MAX_BATCH = 20;

export interface MirrorQueueEntry {
  sequence: number;
  tournamentIds: string[];
  methods: any[];
  createdAt: string;
  attempts: number;
  lastError?: string;
}

/**
 * Local-only service that durably mirrors mutation payloads to the
 * upstream cloud factory-server.
 *
 * Mutations are enqueued to a Postgres-backed queue after local execution
 * succeeds. A background drain loop POSTs them in order to the upstream
 * /factory endpoint with service-to-service auth.
 *
 * The queue survives process restarts — mutations are never lost.
 * Local execution is never blocked or delayed by the mirror.
 */
@Injectable()
export class MutationMirrorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MutationMirrorService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentBackoff = 0;
  private draining = false;

  constructor(
    private readonly config: RelayConfig,
    @Optional() @Inject(PG_POOL) private readonly pool?: Pool,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.pool) {
      this.logger.log('MutationMirrorService disabled (no Postgres pool — STORAGE_PROVIDER != postgres)');
      return;
    }

    await this.ensureTable();

    if (!this.config.upstreamServerUrl) {
      this.logger.log('MutationMirrorService disabled (UPSTREAM_SERVER_URL unset)');
      return;
    }
    this.scheduleNext(DRAIN_INTERVAL_MS);
    this.logger.log(`MutationMirrorService started — target=${this.config.upstreamServerUrl}`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Enqueue a mutation payload for upstream mirroring.
   * Called fire-and-forget from FactoryService after local execution succeeds.
   */
  async enqueue(payload: { tournamentIds: string[]; methods: any[] }): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO mutation_mirror_queue (tournament_ids, methods) VALUES ($1, $2)`,
      [payload.tournamentIds, JSON.stringify(payload.methods)],
    );
  }

  /** Current queue depth — exposed for monitoring / admin UI. */
  async depth(): Promise<number> {
    if (!this.pool) return 0;
    const result = await this.pool.query('SELECT COUNT(*)::int AS count FROM mutation_mirror_queue');
    return result.rows[0].count;
  }

  /** Exposed for tests so we don't need to wait for the timer. */
  async drainOnce(): Promise<{ sent: number; failed: number }> {
    if (this.draining) return { sent: 0, failed: 0 };
    this.draining = true;
    try {
      const batch = await this.peek(MAX_BATCH);
      if (batch.length === 0) return { sent: 0, failed: 0 };

      let sent = 0;
      let failed = 0;

      // Mirror entries one at a time in sequence order — each is an
      // independent executionQueue call on the upstream server.
      for (const entry of batch) {
        try {
          await this.postMutation(entry);
          await this.ack(entry.sequence);
          sent++;
        } catch (err) {
          const message = (err as Error)?.message ?? String(err);
          await this.nack(entry.sequence, message);
          failed++;
          // Stop on first failure — preserve ordering
          this.bumpBackoff();
          this.logger.warn(`mirror failed: ${message} — backoff ${this.currentBackoff}ms`);
          break;
        }
      }

      if (failed === 0) this.currentBackoff = 0;
      return { sent, failed };
    } finally {
      this.draining = false;
    }
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(async () => {
      await this.drainOnce();
      const next = this.currentBackoff > 0 ? this.currentBackoff : DRAIN_INTERVAL_MS;
      if (this.timer !== null) this.scheduleNext(next);
    }, delayMs);
    if (this.timer.unref) this.timer.unref();
  }

  private async postMutation(entry: MirrorQueueEntry): Promise<void> {
    const url = `${this.config.upstreamServerUrl?.replace(/\/$/, '')}/factory`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.upstreamApiKey) {
      headers.Authorization = `Bearer ${this.config.upstreamApiKey}`;
    }
    const body = JSON.stringify({
      tournamentIds: entry.tournamentIds,
      methods: entry.methods,
    });
    const response = await fetch(url, { method: 'POST', headers, body });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  }

  // --- Postgres queue primitives (only called when pool is confirmed non-null) ---

  private async peek(limit: number): Promise<MirrorQueueEntry[]> {
    const result = await this.pool!.query(
      `SELECT sequence, tournament_ids, methods, created_at, attempts, last_error
       FROM mutation_mirror_queue ORDER BY sequence LIMIT $1`,
      [limit],
    );
    return result.rows.map(rowToEntry);
  }

  private async ack(sequence: number): Promise<void> {
    await this.pool!.query('DELETE FROM mutation_mirror_queue WHERE sequence = $1', [sequence]);
  }

  private async nack(sequence: number, error: string): Promise<void> {
    await this.pool!.query(
      `UPDATE mutation_mirror_queue SET attempts = attempts + 1, last_error = $2 WHERE sequence = $1`,
      [sequence, error],
    );
  }

  /** Idempotent table creation — runs on every startup. */
  private async ensureTable(): Promise<void> {
    await this.pool!.query(`
      CREATE TABLE IF NOT EXISTS mutation_mirror_queue (
        sequence       BIGSERIAL PRIMARY KEY,
        tournament_ids TEXT[] NOT NULL DEFAULT '{}',
        methods        JSONB NOT NULL DEFAULT '[]',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        attempts       INTEGER NOT NULL DEFAULT 0,
        last_error     TEXT
      )
    `);
  }

  private bumpBackoff(): void {
    if (this.currentBackoff === 0) {
      this.currentBackoff = DRAIN_INTERVAL_MS;
    } else {
      this.currentBackoff = Math.min(this.currentBackoff * 2, MAX_BACKOFF_MS);
    }
  }
}

function rowToEntry(row: any): MirrorQueueEntry {
  return {
    sequence: Number(row.sequence),
    tournamentIds: row.tournament_ids,
    methods: row.methods,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    attempts: row.attempts,
    lastError: row.last_error ?? undefined,
  };
}
