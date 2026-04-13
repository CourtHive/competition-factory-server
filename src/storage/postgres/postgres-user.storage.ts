import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IUserStorage } from '../interfaces/user-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresUserStorage implements IUserStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findOne(email: string): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT user_id, email, password, provider_id, roles, permissions, data FROM users WHERE email = $1',
      [email],
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
      userId: row.user_id,
      email: row.email,
      password: row.password,
      providerId: row.provider_id,
      roles: row.roles,
      permissions: row.permissions,
      ...row.data,
    };
  }

  async create(user: { email: string; password: string; [key: string]: any }): Promise<any> {
    const { email, password, providerId, roles = [], permissions = [], ...rest } = user;
    await this.pool.query(
      `INSERT INTO users (email, password, provider_id, roles, permissions, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET
         password = EXCLUDED.password,
         provider_id = EXCLUDED.provider_id,
         roles = EXCLUDED.roles,
         permissions = EXCLUDED.permissions,
         data = EXCLUDED.data,
         updated_at = NOW()`,
      [email, password, providerId ?? null, JSON.stringify(roles), JSON.stringify(permissions), JSON.stringify(rest)],
    );
    return user;
  }

  async update(email: string, data: any): Promise<{ success: boolean }> {
    const { password, providerId, roles = [], permissions = [], ...rest } = data;
    await this.pool.query(
      `UPDATE users SET password = $2, provider_id = $3, roles = $4, permissions = $5, data = $6, updated_at = NOW()
       WHERE email = $1`,
      [email, password, providerId ?? null, JSON.stringify(roles), JSON.stringify(permissions), JSON.stringify(rest)],
    );
    return { ...SUCCESS };
  }

  async remove(email: string): Promise<{ success: boolean }> {
    await this.pool.query('DELETE FROM users WHERE email = $1', [email]);
    return { ...SUCCESS };
  }

  async findAll(): Promise<{ success: boolean; users?: any[]; message?: string }> {
    const result = await this.pool.query(
      'SELECT user_id, email, provider_id, roles, permissions, data, last_access FROM users',
    );
    if (!result.rows.length) return { success: false, message: 'No users found' };
    const users = result.rows.map((row) => ({
      key: row.email,
      value: {
        userId: row.user_id,
        email: row.email,
        providerId: row.provider_id,
        roles: row.roles,
        permissions: row.permissions,
        lastAccess: row.last_access,
        ...row.data,
      },
    }));
    return { ...SUCCESS, users };
  }

  async updateLastAccess(email: string): Promise<void> {
    await this.pool.query('UPDATE users SET last_access = NOW() WHERE email = $1', [email]);
  }
}
