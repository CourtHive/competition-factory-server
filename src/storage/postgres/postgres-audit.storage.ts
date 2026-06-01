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

    params.push(clampLimit(options?.limit, 500));
    const sql = `SELECT * FROM audit_log WHERE ${conditions.join(' AND ')} ORDER BY occurred_at DESC LIMIT $${params.length}`;
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

    params.push(clampLimit(options?.limit, 100));
    const sql = `SELECT * FROM audit_log WHERE ${conditions.join(' AND ')} ORDER BY occurred_at DESC LIMIT $${params.length}`;
    const result = await this.pool.query(sql, params);
    return result.rows.map(mapRow);
  }

  async findByActor(
    actorType: 'user' | 'provisioner' | 'provider' | 'service',
    actorId: string,
    options?: { from?: string; to?: string; limit?: number },
  ): Promise<AuditRow[]> {
    const conditions = ['actor_type = $1', 'actor_id = $2'];
    const params: any[] = [actorType, actorId];

    if (options?.from) {
      params.push(options.from);
      conditions.push(`occurred_at >= $${params.length}`);
    }
    if (options?.to) {
      params.push(options.to);
      conditions.push(`occurred_at <= $${params.length}`);
    }

    params.push(clampLimit(options?.limit, 100));
    const sql = `SELECT * FROM audit_log WHERE ${conditions.join(' AND ')} ORDER BY occurred_at DESC LIMIT $${params.length}`;
    const result = await this.pool.query(sql, params);
    return result.rows.map(mapRow);
  }

  async prune(olderThan: Date): Promise<number> {
    const result = await this.pool.query('DELETE FROM audit_log WHERE occurred_at < $1', [olderThan.toISOString()]);
    return result.rowCount ?? 0;
  }

  async incrementFailureCount(actionType: string, errorMessage?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_failure_counts (action_type, count, first_failure_at, last_failure_at, last_failure_message)
       VALUES ($1, 1, NOW(), NOW(), $2)
       ON CONFLICT (action_type) DO UPDATE
         SET count = audit_failure_counts.count + 1,
             last_failure_at = NOW(),
             last_failure_message = EXCLUDED.last_failure_message`,
      [actionType, errorMessage ?? null],
    );
  }

  async clearFailureCount(actionType: string): Promise<void> {
    await this.pool.query('DELETE FROM audit_failure_counts WHERE action_type = $1', [actionType]);
  }

  async loadFailureCounts(): Promise<Array<{ actionType: string; count: number }>> {
    const result = await this.pool.query('SELECT action_type, count FROM audit_failure_counts');
    return result.rows.map((r: any) => ({ actionType: r.action_type, count: r.count }));
  }
}

/**
 * Coerce a caller-supplied `limit` into a safe positive integer for use
 * as a parameter-bound LIMIT. Defends against the SQL-injection vector
 * where an unvalidated body field flows into raw SQL via template
 * interpolation (audit.controller.ts has no DTO/ValidationPipe, so
 * the storage layer is the only enforcement point).
 *
 * Clamping rules:
 *   - undefined / null / non-finite → fallback
 *   - non-number → fallback (Number('100; DROP TABLE ...') is NaN)
 *   - negative or zero → fallback
 *   - greater than 10_000 → 10_000 ceiling
 */
const MAX_LIMIT = 10_000;
function clampLimit(raw: unknown, fallback: number): number {
  const asNumber = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return fallback;
  return Math.min(Math.floor(asNumber), MAX_LIMIT);
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
