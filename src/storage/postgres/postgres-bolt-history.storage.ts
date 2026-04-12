import {
  BoltHistoryDocument,
  IBoltHistoryStorage,
  VERSION_CONFLICT,
} from '../interfaces/bolt-history.interface';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

// Idempotent self-bootstrap DDL — see Decision 2 in EPIXODIC_BOLT_HISTORY_STORAGE.md.
// Mirrored in migrations/003-add-bolt-history.sql for operators who prefer manual apply.
const BOLT_HISTORY_DDL = `
CREATE TABLE IF NOT EXISTS bolt_history (
  tie_matchup_id    TEXT PRIMARY KEY,
  parent_matchup_id TEXT NOT NULL,
  tournament_id     TEXT NOT NULL,
  event_id          TEXT,
  draw_id           TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  data              JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bolt_history_tournament ON bolt_history (tournament_id);
CREATE INDEX IF NOT EXISTS idx_bolt_history_updated_at ON bolt_history (updated_at DESC);
`;

@Injectable()
export class PostgresBoltHistoryStorage implements IBoltHistoryStorage {
  private readonly logger = new Logger(PostgresBoltHistoryStorage.name);
  private schemaEnsured = false;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async ensureSchema(): Promise<{ error?: string }> {
    if (this.schemaEnsured) return {};
    if (!this.pool) {
      return { error: 'PostgresBoltHistoryStorage requires a Pool — set STORAGE_PROVIDER=postgres' };
    }
    await this.pool.query(BOLT_HISTORY_DDL);
    this.schemaEnsured = true;
    this.logger.log('bolt_history schema ensured');
    return {};
  }

  async findBoltHistory({ tieMatchUpId }: { tieMatchUpId: string }) {
    if (!tieMatchUpId) return { error: 'tieMatchUpId required' };
    const schema = await this.ensureSchema();
    if (schema.error) return { error: schema.error };
    const result = await this.pool.query(
      'SELECT data FROM bolt_history WHERE tie_matchup_id = $1',
      [tieMatchUpId],
    );
    if (!result.rows.length) return { error: 'Bolt history not found' };
    return { document: result.rows[0].data as BoltHistoryDocument };
  }

  async saveBoltHistory({ document }: { document: BoltHistoryDocument }) {
    if (!document?.tieMatchUpId) return { error: 'document.tieMatchUpId required' };
    const schema = await this.ensureSchema();
    if (schema.error) return { error: schema.error };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existingResult = await client.query(
        'SELECT version, created_at FROM bolt_history WHERE tie_matchup_id = $1 FOR UPDATE',
        [document.tieMatchUpId],
      );

      const existing = existingResult.rows[0] as { version: number; created_at: Date } | undefined;
      const currentVersion = existing?.version ?? 0;

      if (currentVersion > document.version) {
        await client.query('ROLLBACK');
        return { error: VERSION_CONFLICT };
      }

      const newVersion = currentVersion + 1;
      const now = new Date().toISOString();
      const persisted: BoltHistoryDocument = {
        ...document,
        createdAt: existing?.created_at?.toISOString() ?? document.createdAt ?? now,
        updatedAt: now,
        version: newVersion,
      };
      const dataJson = JSON.stringify(persisted);

      if (!existing) {
        await client.query(
          `INSERT INTO bolt_history
             (tie_matchup_id, parent_matchup_id, tournament_id, event_id, draw_id, version, data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          [
            document.tieMatchUpId,
            document.parentMatchUpId,
            document.tournamentId,
            document.eventId ?? null,
            document.drawId ?? null,
            newVersion,
            dataJson,
          ],
        );
      } else {
        await client.query(
          `UPDATE bolt_history SET
             parent_matchup_id = $2,
             tournament_id     = $3,
             event_id          = $4,
             draw_id           = $5,
             version           = $6,
             data              = $7,
             updated_at        = NOW()
           WHERE tie_matchup_id = $1`,
          [
            document.tieMatchUpId,
            document.parentMatchUpId,
            document.tournamentId,
            document.eventId ?? null,
            document.drawId ?? null,
            newVersion,
            dataJson,
          ],
        );
      }

      await client.query('COMMIT');
      return { ...SUCCESS, version: newVersion };
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.logger.error(`saveBoltHistory failed: ${err?.message ?? err}`);
      return { error: err?.message ?? 'unknown error' };
    } finally {
      client.release();
    }
  }

  async listBoltHistoryForTournament({ tournamentId }: { tournamentId: string }) {
    if (!tournamentId) return { error: 'tournamentId required' };
    const schema = await this.ensureSchema();
    if (schema.error) return { error: schema.error };
    const result = await this.pool.query(
      'SELECT data FROM bolt_history WHERE tournament_id = $1 ORDER BY updated_at DESC',
      [tournamentId],
    );
    return { documents: result.rows.map((row) => row.data as BoltHistoryDocument) };
  }

  async removeBoltHistory({ tieMatchUpId }: { tieMatchUpId: string }) {
    if (!tieMatchUpId) return { error: 'tieMatchUpId required' };
    const schema = await this.ensureSchema();
    if (schema.error) return { error: schema.error };
    await this.pool.query('DELETE FROM bolt_history WHERE tie_matchup_id = $1', [tieMatchUpId]);
    return { ...SUCCESS };
  }
}
