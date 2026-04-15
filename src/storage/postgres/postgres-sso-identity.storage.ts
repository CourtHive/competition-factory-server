import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { ISsoIdentityStorage, SsoIdentityRow } from '../interfaces/sso-identity-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresSsoIdentityStorage implements ISsoIdentityStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findByExternalId(ssoProvider: string, externalId: string): Promise<SsoIdentityRow | null> {
    const result = await this.pool.query(
      'SELECT user_id, sso_provider, external_id, phone, email, created_at FROM sso_identities WHERE sso_provider = $1 AND external_id = $2',
      [ssoProvider, externalId],
    );
    return result.rows.length ? mapRow(result.rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<SsoIdentityRow[]> {
    const result = await this.pool.query(
      'SELECT user_id, sso_provider, external_id, phone, email, created_at FROM sso_identities WHERE user_id = $1 ORDER BY created_at',
      [userId],
    );
    return result.rows.map(mapRow);
  }

  async create(identity: Omit<SsoIdentityRow, 'createdAt'>): Promise<{ success: boolean }> {
    await this.pool.query(
      `INSERT INTO sso_identities (user_id, sso_provider, external_id, phone, email)
       VALUES ($1, $2, $3, $4, $5)`,
      [identity.userId, identity.ssoProvider, identity.externalId, identity.phone ?? null, identity.email ?? null],
    );
    return { ...SUCCESS };
  }

  async update(
    ssoProvider: string,
    externalId: string,
    data: Partial<Pick<SsoIdentityRow, 'phone' | 'email'>>,
  ): Promise<{ success: boolean }> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.phone !== undefined) {
      sets.push(`phone = $${idx++}`);
      values.push(data.phone);
    }
    if (data.email !== undefined) {
      sets.push(`email = $${idx++}`);
      values.push(data.email);
    }

    if (!sets.length) return { ...SUCCESS };

    values.push(ssoProvider, externalId);
    await this.pool.query(
      `UPDATE sso_identities SET ${sets.join(', ')} WHERE sso_provider = $${idx++} AND external_id = $${idx}`,
      values,
    );
    return { ...SUCCESS };
  }

  async remove(ssoProvider: string, externalId: string): Promise<{ success: boolean }> {
    await this.pool.query(
      'DELETE FROM sso_identities WHERE sso_provider = $1 AND external_id = $2',
      [ssoProvider, externalId],
    );
    return { ...SUCCESS };
  }
}

function mapRow(row: any): SsoIdentityRow {
  return {
    userId: row.user_id,
    ssoProvider: row.sso_provider,
    externalId: row.external_id,
    phone: row.phone,
    email: row.email,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}
