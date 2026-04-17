import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IProvisionerProviderStorage, ProvisionerProviderRow } from '../interfaces/provisioner-provider-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresProvisionerProviderStorage implements IProvisionerProviderStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findByProvisioner(provisionerId: string): Promise<ProvisionerProviderRow[]> {
    const result = await this.pool.query(
      `SELECT provisioner_id, provider_id, relationship, granted_by, created_at
       FROM provisioner_providers
       WHERE provisioner_id = $1
       ORDER BY created_at`,
      [provisionerId],
    );
    return result.rows.map(mapRow);
  }

  async findByProvider(providerId: string): Promise<ProvisionerProviderRow[]> {
    const result = await this.pool.query(
      `SELECT provisioner_id, provider_id, relationship, granted_by, created_at
       FROM provisioner_providers
       WHERE provider_id = $1
       ORDER BY created_at`,
      [providerId],
    );
    return result.rows.map(mapRow);
  }

  async getRelationship(provisionerId: string, providerId: string): Promise<'owner' | 'subsidiary' | null> {
    const result = await this.pool.query(
      'SELECT relationship FROM provisioner_providers WHERE provisioner_id = $1 AND provider_id = $2',
      [provisionerId, providerId],
    );
    if (!result.rows.length) return null;
    return result.rows[0].relationship as 'owner' | 'subsidiary';
  }

  async associate(
    provisionerId: string,
    providerId: string,
    relationship: 'owner' | 'subsidiary',
    grantedBy?: string,
  ): Promise<{ success: boolean }> {
    await this.pool.query(
      `INSERT INTO provisioner_providers (provisioner_id, provider_id, relationship, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provisioner_id, provider_id) DO UPDATE SET
         relationship = EXCLUDED.relationship,
         granted_by = EXCLUDED.granted_by`,
      [provisionerId, providerId, relationship, grantedBy ?? null],
    );
    return { ...SUCCESS };
  }

  async updateRelationship(
    provisionerId: string,
    providerId: string,
    relationship: 'owner' | 'subsidiary',
  ): Promise<{ success: boolean }> {
    await this.pool.query(
      'UPDATE provisioner_providers SET relationship = $1 WHERE provisioner_id = $2 AND provider_id = $3',
      [relationship, provisionerId, providerId],
    );
    return { ...SUCCESS };
  }

  async disassociate(provisionerId: string, providerId: string): Promise<{ success: boolean }> {
    await this.pool.query(
      'DELETE FROM provisioner_providers WHERE provisioner_id = $1 AND provider_id = $2',
      [provisionerId, providerId],
    );
    return { ...SUCCESS };
  }
}

function mapRow(row: any): ProvisionerProviderRow {
  return {
    provisionerId: row.provisioner_id,
    providerId: row.provider_id,
    relationship: row.relationship,
    grantedBy: row.granted_by,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}
