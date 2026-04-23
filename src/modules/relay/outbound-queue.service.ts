import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from 'src/storage/postgres/postgres.config';
import { QueueEntry, QueueEntryKind } from './types/queue-entry';

export interface EnqueueArgs {
  venueId: string;
  kind: QueueEntryKind;
  matchUpId: string;
  payload: unknown;
}

@Injectable()
export class OutboundQueueService implements OnModuleInit {
  private readonly logger = new Logger(OutboundQueueService.name);

  constructor(@Optional() @Inject(PG_POOL) private readonly pool?: Pool) {}

  async onModuleInit(): Promise<void> {
    if (!this.pool) {
      this.logger.warn('OutboundQueueService: no Postgres pool — queue operations will be no-ops');
      return;
    }
    await this.ensureTable();
  }

  async enqueue(args: EnqueueArgs): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO outbound_relay_queue (venue_id, kind, match_up_id, payload) VALUES ($1, $2, $3, $4)`,
      [args.venueId, args.kind, args.matchUpId, JSON.stringify(args.payload)],
    );
  }

  async peek(limit: number): Promise<QueueEntry[]> {
    if (!this.pool) return [];
    const result = await this.pool.query(
      `SELECT sequence, venue_id, kind, match_up_id, payload, created_at, attempts, last_error
       FROM outbound_relay_queue ORDER BY sequence LIMIT $1`,
      [Math.max(0, limit)],
    );
    return result.rows.map(rowToEntry);
  }

  async ack(sequences: number[]): Promise<void> {
    if (!this.pool || sequences.length === 0) return;
    await this.pool.query(
      'DELETE FROM outbound_relay_queue WHERE sequence = ANY($1::bigint[])',
      [sequences],
    );
  }

  async nack(sequence: number, error: string): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(
      `UPDATE outbound_relay_queue SET attempts = attempts + 1, last_error = $2 WHERE sequence = $1`,
      [sequence, error],
    );
  }

  async depth(): Promise<number> {
    if (!this.pool) return 0;
    const result = await this.pool.query('SELECT COUNT(*)::int AS count FROM outbound_relay_queue');
    return result.rows[0].count;
  }

  private async ensureTable(): Promise<void> {
    await this.pool!.query(`
      CREATE TABLE IF NOT EXISTS outbound_relay_queue (
        sequence       BIGSERIAL PRIMARY KEY,
        venue_id       TEXT NOT NULL,
        kind           TEXT NOT NULL,
        match_up_id    TEXT NOT NULL,
        payload        JSONB NOT NULL DEFAULT '{}',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        attempts       INTEGER NOT NULL DEFAULT 0,
        last_error     TEXT
      )
    `);
  }
}

function rowToEntry(row: any): QueueEntry {
  return {
    sequence: Number(row.sequence),
    venueId: row.venue_id,
    kind: row.kind as QueueEntryKind,
    matchUpId: row.match_up_id,
    payload: row.payload,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    attempts: row.attempts,
    lastError: row.last_error ?? undefined,
  };
}
