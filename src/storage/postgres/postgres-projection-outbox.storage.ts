import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { IProjectionOutboxStorage, ProjectionDelta } from '../interfaces/projection-outbox-storage.interface';
import { PG_POOL } from './postgres.config';

/**
 * Postgres-backed writer for the read-model projection outbox
 * (`projection_queue`, migration 039). CFS is the SINGLE writer; the
 * courthive-query consumer reads + watermarks its own cursor.
 *
 * Gated by `PROJECTION_OUTBOX_ENABLED` so the whole producer path is inert
 * until switched on — when disabled, `isEnabled` is false and executionQueue
 * never builds a delta buffer, so no rows are ever written.
 */
@Injectable()
export class PostgresProjectionOutboxStorage implements IProjectionOutboxStorage {
  private readonly logger = new Logger(PostgresProjectionOutboxStorage.name);
  readonly isEnabled: boolean;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {
    this.isEnabled = pool !== null && process.env.PROJECTION_OUTBOX_ENABLED === 'true';
  }

  async enqueue(deltas: ProjectionDelta[]): Promise<void> {
    if (!deltas.length) return;

    // One multi-row INSERT — six columns per delta. Build the VALUES
    // placeholders ($1..$6, $7..$12, …) and a flat params array.
    const valueGroups: string[] = [];
    const params: any[] = [];
    for (const delta of deltas) {
      const base = params.length;
      valueGroups.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
      params.push(
        delta.tournamentId,
        delta.op,
        delta.table,
        JSON.stringify(delta.key),
        delta.row === undefined ? null : JSON.stringify(delta.row),
        delta.topic ?? null,
      );
    }

    await this.pool.query(
      `INSERT INTO projection_queue (tournament_id, op, table_name, row_key, row_data, topic)
       VALUES ${valueGroups.join(', ')}`,
      params,
    );
    this.logger.debug(`enqueued ${deltas.length} projection delta(s)`);
  }
}
