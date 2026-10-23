import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from './postgres.config';

import type {
  DrawIntegrityFindingRow,
  DrawOpenFindings,
  IDrawIntegrityFindingsStorage,
} from '../interfaces/draw-integrity-findings-storage.interface';

const COLUMNS = [
  'observed_at',
  'tournament_id',
  'draw_id',
  'event',
  'code',
  'severity',
  'fingerprint',
  'structure_id',
  'matchup_id',
  'methods',
];

/** `draw_integrity_findings` (migration 056). */
@Injectable()
export class PostgresDrawIntegrityFindingsStorage implements IDrawIntegrityFindingsStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async append(rows: DrawIntegrityFindingRow[]): Promise<void> {
    if (!rows.length) return;
    const params: any[] = [];
    const groups: string[] = [];
    for (const row of rows) {
      const base = params.length;
      groups.push(`(${COLUMNS.map((_, index) => `$${base + index + 1}`).join(', ')})`);
      params.push(
        row.observedAt,
        row.tournamentId,
        row.drawId,
        row.event,
        row.code,
        row.severity,
        row.fingerprint,
        row.structureId ?? null,
        row.matchUpId ?? null,
        row.methods,
      );
    }
    // One statement, so the rows of one flush get ids in array order: the seed breaks an observed_at tie on id.
    await this.pool.query(
      `INSERT INTO draw_integrity_findings (${COLUMNS.join(', ')}) VALUES ${groups.join(', ')}`,
      params,
    );
  }

  async loadOpenFindings(tournamentId: string, drawId: string): Promise<DrawOpenFindings> {
    const result = await this.pool.query(
      `SELECT DISTINCT ON (fingerprint) fingerprint, event, code, severity, structure_id, matchup_id
         FROM draw_integrity_findings
        WHERE draw_id = $1 AND tournament_id = $2
        ORDER BY fingerprint, observed_at DESC, id DESC`,
      [drawId, tournamentId],
    );
    const open = result.rows
      .filter((row) => row.event !== 'resolved')
      .map((row) => ({
        fingerprint: row.fingerprint,
        code: row.code,
        severity: row.severity,
        structureId: row.structure_id ?? undefined,
        matchUpId: row.matchup_id ?? undefined,
      }));
    return { known: result.rows.length > 0, open };
  }
}
