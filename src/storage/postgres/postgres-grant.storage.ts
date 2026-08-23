import { Inject, Injectable } from '@nestjs/common';

import type { IGrantStorage, TournamentGrantRow } from '../interfaces/grant-storage.interface';
import { PG_POOL } from './postgres.config';

const COLUMNS = `grant_id, tournament_id, user_id, provider_id, capability, scope, not_before, not_after, granted_by, granted_at`;

function toRow(row: any): TournamentGrantRow {
  return {
    grantId: row.grant_id,
    tournamentId: row.tournament_id,
    userId: row.user_id,
    providerId: row.provider_id,
    capability: row.capability,
    scope: row.scope ?? {},
    notBefore: row.not_before,
    notAfter: row.not_after,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
  };
}

@Injectable()
export class PostgresGrantStorage implements IGrantStorage {
  constructor(@Inject(PG_POOL) private readonly pool: any) {}

  async findForSubject(userId: string, tournamentId: string): Promise<TournamentGrantRow[]> {
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM tournament_grants WHERE user_id = $1 AND tournament_id = $2`,
      [userId, tournamentId],
    );
    return result.rows.map(toRow);
  }

  async findByTournamentId(tournamentId: string): Promise<TournamentGrantRow[]> {
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM tournament_grants WHERE tournament_id = $1 ORDER BY granted_at`,
      [tournamentId],
    );
    return result.rows.map(toRow);
  }

  async create(row: Omit<TournamentGrantRow, 'grantId' | 'grantedAt'>): Promise<{ grantId: string }> {
    const result = await this.pool.query(
      `INSERT INTO tournament_grants
         (tournament_id, user_id, provider_id, capability, scope, not_before, not_after, granted_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING grant_id`,
      [
        row.tournamentId,
        row.userId,
        row.providerId,
        row.capability,
        JSON.stringify(row.scope ?? {}),
        row.notBefore ?? null,
        row.notAfter ?? null,
        row.grantedBy ?? null,
      ],
    );
    return { grantId: result.rows[0].grant_id };
  }

  async revoke(grantId: string): Promise<{ success: boolean }> {
    const result = await this.pool.query(`DELETE FROM tournament_grants WHERE grant_id = $1`, [grantId]);
    return { success: (result.rowCount ?? 0) > 0 };
  }

  async revokeForSubject(userId: string, tournamentId: string): Promise<{ revoked: number }> {
    const result = await this.pool.query(
      `DELETE FROM tournament_grants WHERE user_id = $1 AND tournament_id = $2`,
      [userId, tournamentId],
    );
    return { revoked: result.rowCount ?? 0 };
  }
}
