import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

import { PG_POOL } from './postgres.config';
import {
  FencedEnqueueResult,
  IProjectionOutboxStorage,
  ProjectionDelta,
  ProjectionSource,
  SnapshotRequest,
} from '../interfaces/projection-outbox-storage.interface';

/**
 * Postgres-backed writer for the read-model projection outbox
 * (`projection_queue`, migration 039). CFS is the SINGLE writer; the
 * courthive-query consumer reads + watermarks its own cursor.
 *
 * Gated by `PROJECTION_OUTBOX_ENABLED` so the whole producer path is inert
 * until switched on — when disabled, `isEnabled` is false and executionQueue
 * never builds a delta buffer, so no rows are ever written.
 */
/** Seven bind parameters per row: 5,000 rows is 35,000, well inside Postgres's 65,535. */
export const MAX_DELTAS_PER_STATEMENT = 5_000;

@Injectable()
export class PostgresProjectionOutboxStorage implements IProjectionOutboxStorage {
  private readonly logger = new Logger(PostgresProjectionOutboxStorage.name);
  readonly isEnabled: boolean;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    this.isEnabled = pool !== null && process.env.PROJECTION_OUTBOX_ENABLED === 'true';
  }

  async enqueue(deltas: ProjectionDelta[], options?: { client?: PoolClient }): Promise<void> {
    if (!deltas.length) return;
    if (options?.client) {
      await this.insertChunks(options.client, deltas);
      return;
    }
    // One transaction even when the span needs several statements: the consumer must never see part of a span.
    await this.inTransaction((client) => this.insertChunks(client, deltas));
  }

  async readForProjection(tournamentId: string): Promise<ProjectionSource | undefined> {
    const result = await this.pool.query(
      'SELECT data, updated_at::text AS updated_at FROM tournaments WHERE tournament_id = $1',
      [tournamentId],
    );
    const row = result.rows[0];
    return row ? { tournamentRecord: row.data, updatedAt: row.updated_at } : undefined;
  }

  async enqueueIfUnchanged({
    tournamentId,
    updatedAt,
    deltas,
  }: {
    tournamentId: string;
    updatedAt: string;
    deltas: ProjectionDelta[];
  }): Promise<FencedEnqueueResult> {
    return this.inTransaction((client) => this.fencedInsert(client, tournamentId, updatedAt, deltas));
  }

  async requestSnapshots(tournamentIds: string[], source: string, options?: { client?: PoolClient }): Promise<void> {
    const ids = [...new Set(tournamentIds)].filter(Boolean);
    if (!ids.length) return;
    await (options?.client ?? this.pool).query(
      `INSERT INTO projection_snapshot_requests (tournament_id, source)
       SELECT unnest($1::text[]), $2
       ON CONFLICT (tournament_id) DO UPDATE SET
         requested_at = NOW(), source = EXCLUDED.source, attempts = 0, last_error = NULL`,
      [ids, source],
    );
  }

  async pendingSnapshotRequests(limit: number): Promise<SnapshotRequest[]> {
    const result = await this.pool.query(
      `SELECT tournament_id, requested_at::text AS requested_at, source, attempts
         FROM projection_snapshot_requests ORDER BY requested_at ASC LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      tournamentId: row.tournament_id,
      requestedAt: row.requested_at,
      source: row.source ?? undefined,
      attempts: Number(row.attempts),
    }));
  }

  async completeSnapshot({
    tournamentId,
    requestedAt,
    updatedAt,
    deltas,
  }: {
    tournamentId: string;
    requestedAt: string;
    updatedAt: string;
    deltas: ProjectionDelta[];
  }): Promise<FencedEnqueueResult> {
    return this.inTransaction(async (client) => {
      const outcome = await this.fencedInsert(client, tournamentId, updatedAt, deltas);
      if (outcome !== 'changed') {
        // Only the request this span served. A save that re-requested it meanwhile changed requested_at, and its
        // request stays for the next build.
        await client.query(
          'DELETE FROM projection_snapshot_requests WHERE tournament_id = $1 AND requested_at::text = $2',
          [tournamentId, requestedAt],
        );
      }
      return outcome;
    });
  }

  async recordSnapshotFailure(tournamentId: string, error: string): Promise<void> {
    await this.pool.query(
      'UPDATE projection_snapshot_requests SET attempts = attempts + 1, last_error = $2 WHERE tournament_id = $1',
      [tournamentId, error.slice(0, 2000)],
    );
  }

  /**
   * FOR SHARE: a save of this tournament (INSERT … ON CONFLICT DO UPDATE takes the row lock) waits for the calling
   * transaction, so its deltas land after these. Compared as text: `updated_at` keeps microseconds a JS Date drops.
   */
  private async fencedInsert(
    client: PoolClient,
    tournamentId: string,
    updatedAt: string,
    deltas: ProjectionDelta[],
  ): Promise<FencedEnqueueResult> {
    const fence = await client.query(
      'SELECT updated_at::text = $2 AS unchanged FROM tournaments WHERE tournament_id = $1 FOR SHARE',
      [tournamentId, updatedAt],
    );
    if (!fence.rows.length) return 'missing';
    if (!fence.rows[0].unchanged) return 'changed';
    await this.insertChunks(client, deltas);
    return 'enqueued';
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Multi-row INSERTs of at most MAX_DELTAS_PER_STATEMENT rows. One statement used to carry the whole span: at seven
   * bind parameters a row, a span over ~9,300 deltas exceeds Postgres's 65,535 and failed (fail-soft, read model
   * silently stale). Records near the 8 MB body limit can produce spans that large.
   */
  private async insertChunks(client: PoolClient, deltas: ProjectionDelta[]): Promise<void> {
    for (let start = 0; start < deltas.length; start += MAX_DELTAS_PER_STATEMENT) {
      const chunk = deltas.slice(start, start + MAX_DELTAS_PER_STATEMENT);
      const valueGroups: string[] = [];
      const params: any[] = [];
      for (const delta of chunk) {
        const base = params.length;
        valueGroups.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
        );
        params.push(
          delta.tournamentId,
          delta.op,
          delta.table,
          JSON.stringify(delta.key),
          delta.row === undefined ? null : JSON.stringify(delta.row),
          delta.topic ?? null,
          delta.snapshotId ?? null,
        );
      }
      await client.query(
        `INSERT INTO projection_queue (tournament_id, op, table_name, row_key, row_data, topic, snapshot_id)
         VALUES ${valueGroups.join(', ')}`,
        params,
      );
    }
    this.logger.debug(`enqueued ${deltas.length} projection delta(s)`);
  }
}
