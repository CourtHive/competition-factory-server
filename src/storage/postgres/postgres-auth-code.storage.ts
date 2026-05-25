import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IAuthCodeStorage } from '../interfaces/auth-code-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresAuthCodeStorage implements IAuthCodeStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getResetCode(code: string): Promise<any | null> {
    const result = await this.pool.query('SELECT code, email FROM reset_codes WHERE code = $1', [code]);
    if (!result.rows.length) return null;
    return { code: result.rows[0].code, email: result.rows[0].email };
  }

  async setResetCode(code: string, value: any): Promise<{ success: boolean }> {
    const email = typeof value === 'string' ? value : value?.email;
    await this.pool.query(
      `INSERT INTO reset_codes (code, email) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET email = EXCLUDED.email`,
      [code, email],
    );
    return { ...SUCCESS };
  }

  async deleteResetCode(code: string): Promise<{ success: boolean }> {
    await this.pool.query('DELETE FROM reset_codes WHERE code = $1', [code]);
    return { ...SUCCESS };
  }

  async setAccessCode(code: string, email: string, expiresAt: string): Promise<{ success: boolean }> {
    await this.pool.query(
      `INSERT INTO access_codes (code, email, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET email = EXCLUDED.email, expires_at = EXCLUDED.expires_at`,
      [code, email, expiresAt],
    );
    return { ...SUCCESS };
  }

  async consumeAccessCode(code: string): Promise<string | null> {
    // Single-use + expiry in one statement: delete the row and return its
    // email only when it exists and is still valid. A redeemed or expired code
    // matches nothing and yields null.
    const result = await this.pool.query(
      `DELETE FROM access_codes
        WHERE code = $1 AND (expires_at IS NULL OR expires_at > NOW())
        RETURNING email`,
      [code],
    );
    return result.rows.length ? result.rows[0].email : null;
  }
}
