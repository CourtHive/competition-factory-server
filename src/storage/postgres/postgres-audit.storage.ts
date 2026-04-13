import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IAuditStorage, AuditRow } from '../interfaces/audit-storage.interface';
import { PG_POOL } from './postgres.config';

@Injectable()
export class PostgresAuditStorage implements IAuditStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async append(row: AuditRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log (audit_id, tournament_id, user_id, user_email, source, occurred_at, action_type, methods, status, metadata, error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        row.auditId,
        row.tournamentId,
        row.userId ?? null,
        row.userEmail ?? null,
        row.source ?? 'tmx',
        row.occurredAt,
        row.actionType,
        JSON.stringify(row.methods),
        row.status,
        JSON.stringify(row.metadata ?? {}),
        row.errorCode ?? null,
      ],
    );
  }

  async findByTournamentId(
    tournamentId: string,
    options?: { from?: string; to?: string; limit?: number },
  ): Promise<AuditRow[]> {
    const conditions = ['tournament_id = $1'];
    const params: any[] = [tournamentId];

    if (options?.from) {
      params.push(options.from);
      conditions.push(`occurred_at >= $${params.length}`);
    }
    if (options?.to) {
      params.push(options.to);
      conditions.push(`occurred_at <= $${params.length}`);
    }

    const limit = options?.limit ?? 500;
    const sql = `SELECT * FROM audit_log WHERE ${conditions.join(' AND ')} ORDER BY occurred_at DESC LIMIT ${limit}`;
    const result = await this.pool.query(sql, params);
    return result.rows.map(mapRow);
  }

  async findByActionType(
    actionType: string,
    options?: { from?: string; to?: string; limit?: number },
  ): Promise<AuditRow[]> {
    const conditions = ['action_type = $1'];
    const params: any[] = [actionType];

    if (options?.from) {
      params.push(options.from);
      conditions.push(`occurred_at >= $${params.length}`);
    }
    if (options?.to) {
      params.push(options.to);
      conditions.push(`occurred_at <= $${params.length}`);
    }

    const limit = options?.limit ?? 100;
    const sql = `SELECT * FROM audit_log WHERE ${conditions.join(' AND ')} ORDER BY occurred_at DESC LIMIT ${limit}`;
    const result = await this.pool.query(sql, params);
    return result.rows.map(mapRow);
  }

  async prune(olderThan: Date): Promise<number> {
    const result = await this.pool.query('DELETE FROM audit_log WHERE occurred_at < $1', [olderThan.toISOString()]);
    return result.rowCount ?? 0;
  }
}

function mapRow(row: any): AuditRow {
  return {
    auditId: row.audit_id,
    tournamentId: row.tournament_id,
    userId: row.user_id,
    userEmail: row.user_email,
    source: row.source,
    occurredAt: row.occurred_at?.toISOString?.() ?? row.occurred_at,
    actionType: row.action_type,
    methods: row.methods,
    status: row.status,
    metadata: row.metadata,
    errorCode: row.error_code,
  };
}
