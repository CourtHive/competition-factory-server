import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IRefreshTokenStorage, RefreshTokenRow } from '../interfaces/refresh-token-storage.interface';
import { PG_POOL } from './postgres.config';

@Injectable()
export class PostgresRefreshTokenStorage implements IRefreshTokenStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async create(input: {
    userId: string;
    email: string;
    tokenHash: string;
    familyId: string;
    expiresAt: string;
    userAgent?: string;
  }): Promise<RefreshTokenRow> {
    const result = await this.pool.query(
      `INSERT INTO refresh_tokens (user_id, email, token_hash, family_id, expires_at, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING token_id, user_id, email, token_hash, family_id, expires_at, created_at, revoked_at, replaced_by, user_agent`,
      [input.userId, input.email, input.tokenHash, input.familyId, input.expiresAt, input.userAgent ?? null],
    );
    return mapRow(result.rows[0]);
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
    const result = await this.pool.query(
      `SELECT token_id, user_id, email, token_hash, family_id, expires_at, created_at, revoked_at, replaced_by, user_agent
       FROM refresh_tokens
       WHERE token_hash = $1`,
      [tokenHash],
    );
    return result.rows.length ? mapRow(result.rows[0]) : null;
  }

  async revoke(tokenId: string, replacedBy?: string): Promise<void> {
    await this.pool.query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW(), replaced_by = COALESCE($2, replaced_by)
       WHERE token_id = $1 AND revoked_at IS NULL`,
      [tokenId, replacedBy ?? null],
    );
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL',
      [familyId],
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
  }

  async deleteExpired(): Promise<number> {
    const result = await this.pool.query('DELETE FROM refresh_tokens WHERE expires_at <= NOW()');
    return result.rowCount ?? 0;
  }
}

function mapRow(row: any): RefreshTokenRow {
  return {
    tokenId: row.token_id,
    userId: row.user_id,
    email: row.email,
    tokenHash: row.token_hash,
    familyId: row.family_id,
    expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    revokedAt: row.revoked_at?.toISOString?.() ?? row.revoked_at ?? null,
    replacedBy: row.replaced_by ?? null,
    userAgent: row.user_agent ?? null,
  };
}
