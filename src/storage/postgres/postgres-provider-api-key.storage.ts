import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IProviderApiKeyStorage, ProviderApiKeyRow } from '../interfaces/provider-api-key-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresProviderApiKeyStorage implements IProviderApiKeyStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findByKeyHash(
    hash: string,
  ): Promise<{ key: ProviderApiKeyRow; providerName: string; providerConfig: Record<string, any> } | null> {
    const result = await this.pool.query(
      `SELECT k.key_id, k.provider_id, k.api_key_hash, k.label, k.is_active,
              k.last_used_at, k.created_at, k.expires_at,
              p.organisation_name AS provider_name, p.provider_config AS provider_config
       FROM provider_api_keys k
       JOIN providers p ON p.provider_id = k.provider_id
       WHERE k.api_key_hash = $1
         AND k.is_active = true
         AND (k.expires_at IS NULL OR k.expires_at > NOW())`,
      [hash],
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
      key: mapKeyRow(row),
      providerName: row.provider_name,
      providerConfig: row.provider_config ?? {},
    };
  }

  async create(
    key: Omit<ProviderApiKeyRow, 'keyId' | 'createdAt' | 'lastUsedAt'>,
  ): Promise<ProviderApiKeyRow> {
    const result = await this.pool.query(
      `INSERT INTO provider_api_keys (provider_id, api_key_hash, label, is_active, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING key_id, provider_id, api_key_hash, label, is_active, last_used_at, created_at, expires_at`,
      [key.providerId, key.apiKeyHash, key.label ?? null, key.isActive ?? true, key.expiresAt ?? null],
    );
    return mapKeyRow(result.rows[0]);
  }

  async revoke(keyId: string): Promise<{ success: boolean }> {
    await this.pool.query(
      'UPDATE provider_api_keys SET is_active = false WHERE key_id = $1',
      [keyId],
    );
    return { ...SUCCESS };
  }

  async listByProvider(providerId: string): Promise<ProviderApiKeyRow[]> {
    const result = await this.pool.query(
      `SELECT key_id, provider_id, api_key_hash, label, is_active, last_used_at, created_at, expires_at
       FROM provider_api_keys
       WHERE provider_id = $1
       ORDER BY created_at`,
      [providerId],
    );
    return result.rows.map(mapKeyRow);
  }

  async updateLastUsed(keyId: string): Promise<void> {
    await this.pool.query(
      'UPDATE provider_api_keys SET last_used_at = NOW() WHERE key_id = $1',
      [keyId],
    );
  }
}

function mapKeyRow(row: any): ProviderApiKeyRow {
  return {
    keyId: row.key_id,
    providerId: row.provider_id,
    apiKeyHash: row.api_key_hash,
    label: row.label,
    isActive: row.is_active,
    lastUsedAt: row.last_used_at?.toISOString?.() ?? row.last_used_at,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at,
  };
}
