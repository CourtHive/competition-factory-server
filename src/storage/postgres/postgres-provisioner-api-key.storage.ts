import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IProvisionerApiKeyStorage, ProvisionerApiKeyRow } from '../interfaces/provisioner-api-key-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresProvisionerApiKeyStorage implements IProvisionerApiKeyStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findByKeyHash(
    hash: string,
  ): Promise<{ key: ProvisionerApiKeyRow; provisionerName: string; provisionerConfig: Record<string, any> } | null> {
    const result = await this.pool.query(
      `SELECT k.key_id, k.provisioner_id, k.api_key_hash, k.label, k.is_active,
              k.last_used_at, k.created_at, k.expires_at,
              p.name AS provisioner_name, p.config AS provisioner_config
       FROM provisioner_api_keys k
       JOIN provisioners p ON p.provisioner_id = k.provisioner_id
       WHERE k.api_key_hash = $1
         AND k.is_active = true
         AND p.is_active = true
         AND (k.expires_at IS NULL OR k.expires_at > NOW())`,
      [hash],
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
      key: mapKeyRow(row),
      provisionerName: row.provisioner_name,
      provisionerConfig: row.provisioner_config ?? {},
    };
  }

  async create(
    key: Omit<ProvisionerApiKeyRow, 'keyId' | 'createdAt' | 'lastUsedAt'>,
  ): Promise<ProvisionerApiKeyRow> {
    const result = await this.pool.query(
      `INSERT INTO provisioner_api_keys (provisioner_id, api_key_hash, label, is_active, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING key_id, provisioner_id, api_key_hash, label, is_active, last_used_at, created_at, expires_at`,
      [key.provisionerId, key.apiKeyHash, key.label ?? null, key.isActive ?? true, key.expiresAt ?? null],
    );
    return mapKeyRow(result.rows[0]);
  }

  async revoke(keyId: string): Promise<{ success: boolean }> {
    await this.pool.query(
      'UPDATE provisioner_api_keys SET is_active = false WHERE key_id = $1',
      [keyId],
    );
    return { ...SUCCESS };
  }

  async listByProvisioner(provisionerId: string): Promise<ProvisionerApiKeyRow[]> {
    const result = await this.pool.query(
      `SELECT key_id, provisioner_id, api_key_hash, label, is_active, last_used_at, created_at, expires_at
       FROM provisioner_api_keys
       WHERE provisioner_id = $1
       ORDER BY created_at`,
      [provisionerId],
    );
    return result.rows.map(mapKeyRow);
  }

  async updateLastUsed(keyId: string): Promise<void> {
    await this.pool.query(
      'UPDATE provisioner_api_keys SET last_used_at = NOW() WHERE key_id = $1',
      [keyId],
    );
  }
}

function mapKeyRow(row: any): ProvisionerApiKeyRow {
  return {
    keyId: row.key_id,
    provisionerId: row.provisioner_id,
    apiKeyHash: row.api_key_hash,
    label: row.label,
    isActive: row.is_active,
    lastUsedAt: row.last_used_at?.toISOString?.() ?? row.last_used_at,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    expiresAt: row.expires_at?.toISOString?.() ?? row.expires_at,
  };
}
