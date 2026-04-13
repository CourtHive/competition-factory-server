import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IUserProviderStorage, UserProviderRow } from '../interfaces/user-provider-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresUserProviderStorage implements IUserProviderStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findByUserId(userId: string): Promise<UserProviderRow[]> {
    const result = await this.pool.query(
      `SELECT up.user_id, up.provider_id, up.provider_role, up.created_at, up.updated_at, u.email
       FROM user_providers up
       JOIN users u ON u.user_id = up.user_id
       WHERE up.user_id = $1
       ORDER BY up.provider_id`,
      [userId],
    );
    return result.rows.map(mapRow);
  }

  async findByEmail(email: string): Promise<UserProviderRow[]> {
    const result = await this.pool.query(
      `SELECT up.user_id, up.provider_id, up.provider_role, up.created_at, up.updated_at, u.email
       FROM user_providers up
       JOIN users u ON u.user_id = up.user_id
       WHERE u.email = $1
       ORDER BY up.provider_id`,
      [email],
    );
    return result.rows.map(mapRow);
  }

  async findByProviderId(providerId: string): Promise<UserProviderRow[]> {
    const result = await this.pool.query(
      `SELECT up.user_id, up.provider_id, up.provider_role, up.created_at, up.updated_at, u.email
       FROM user_providers up
       JOIN users u ON u.user_id = up.user_id
       WHERE up.provider_id = $1
       ORDER BY u.email`,
      [providerId],
    );
    return result.rows.map(mapRow);
  }

  async findOne(userId: string, providerId: string): Promise<UserProviderRow | null> {
    const result = await this.pool.query(
      `SELECT up.user_id, up.provider_id, up.provider_role, up.created_at, up.updated_at, u.email
       FROM user_providers up
       JOIN users u ON u.user_id = up.user_id
       WHERE up.user_id = $1 AND up.provider_id = $2`,
      [userId, providerId],
    );
    return result.rows.length ? mapRow(result.rows[0]) : null;
  }

  async upsert(row: UserProviderRow): Promise<{ success: boolean }> {
    await this.pool.query(
      `INSERT INTO user_providers (user_id, provider_id, provider_role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, provider_id) DO UPDATE SET
         provider_role = EXCLUDED.provider_role,
         updated_at = NOW()`,
      [row.userId, row.providerId, row.providerRole],
    );
    return { ...SUCCESS };
  }

  async remove(userId: string, providerId: string): Promise<{ success: boolean }> {
    await this.pool.query(
      'DELETE FROM user_providers WHERE user_id = $1 AND provider_id = $2',
      [userId, providerId],
    );
    return { ...SUCCESS };
  }
}

function mapRow(row: any): UserProviderRow {
  return {
    userId: row.user_id,
    providerId: row.provider_id,
    providerRole: row.provider_role,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    email: row.email,
  };
}
