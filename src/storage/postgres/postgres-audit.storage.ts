import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IAuditStorage, AuditRow } from '../interfaces/audit-storage.interface';
import { PG_POOL } from './postgres.config';

@Injectable()
export class PostgresAuditStorage implements IAuditStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async append(row: AuditRow): Promise<void> {
    // user_id stays nullable for back-compat; new writes prefer the
    // polymorphic actor pair. When the caller only sent a userId (a
    // bare UUID), populate both — `actor` gets {kind:'user', id} so
    // queries on the new path see it.
    const isUuid = (s: string | undefined): boolean =>
      typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const legacyUserUuid = !row.actor && isUuid(row.userId) ? row.userId : null;
    const actor =
      row.actor ?? (isUuid(row.userId) ? { kind: 'user' as const, id: row.userId! } : undefined);

    await this.pool.query(
      `INSERT INTO audit_log
         (audit_id, tournament_id, user_id, user_email, source, occurred_at,
          action_type, methods, status, metadata, error_code, actor_type, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        row.auditId,
        row.tournamentId,
        legacyUserUuid,
        row.userEmail ?? null,
        row.source ?? 'tmx',
        row.occurredAt,
        row.actionType,
        JSON.stringify(row.methods),
        row.status,
        JSON.stringify(row.metadata ?? {}),
        row.errorCode ?? null,
        actor?.kind ?? null,
        actor?.id ?? null,
      ],
    );
  }

  async findById(auditId: string): Promise<AuditRow | null> {
    const result = await this.pool.query('SELECT * FROM audit_log WHERE audit_id = $1 LIMIT 1', [auditId]);
    return result.rows.length ? mapRow(result.rows[0]) : null;
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
  const actor =
    row.actor_type && row.actor_id
      ? { kind: row.actor_type as 'user' | 'provisioner' | 'provider' | 'service', id: row.actor_id }
      : undefined;
  return {
    auditId: row.audit_id,
    tournamentId: row.tournament_id,
    userId: row.user_id,
    userEmail: row.user_email,
    actor,
    source: row.source,
    occurredAt: row.occurred_at?.toISOString?.() ?? row.occurred_at,
    actionType: row.action_type,
    methods: row.methods,
    status: row.status,
    metadata: row.metadata,
    errorCode: row.error_code,
  };
}
