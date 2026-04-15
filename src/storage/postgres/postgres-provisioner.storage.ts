import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IProvisionerStorage, ProvisionerRow } from '../interfaces/provisioner-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresProvisionerStorage implements IProvisionerStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getProvisioner(provisionerId: string): Promise<ProvisionerRow | null> {
    const result = await this.pool.query(
      'SELECT provisioner_id, name, is_active, config, created_at, updated_at FROM provisioners WHERE provisioner_id = $1',
      [provisionerId],
    );
    return result.rows.length ? mapRow(result.rows[0]) : null;
  }

  async findByName(name: string): Promise<ProvisionerRow | null> {
    const result = await this.pool.query(
      'SELECT provisioner_id, name, is_active, config, created_at, updated_at FROM provisioners WHERE name = $1',
      [name],
    );
    return result.rows.length ? mapRow(result.rows[0]) : null;
  }

  async findAll(): Promise<ProvisionerRow[]> {
    const result = await this.pool.query(
      'SELECT provisioner_id, name, is_active, config, created_at, updated_at FROM provisioners ORDER BY created_at',
    );
    return result.rows.map(mapRow);
  }

  async create(
    provisioner: Omit<ProvisionerRow, 'provisionerId' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProvisionerRow> {
    const result = await this.pool.query(
      `INSERT INTO provisioners (name, is_active, config)
       VALUES ($1, $2, $3)
       RETURNING provisioner_id, name, is_active, config, created_at, updated_at`,
      [provisioner.name, provisioner.isActive ?? true, JSON.stringify(provisioner.config ?? {})],
    );
    return mapRow(result.rows[0]);
  }

  async update(
    provisionerId: string,
    data: Partial<Pick<ProvisionerRow, 'name' | 'isActive' | 'config'>>,
  ): Promise<{ success: boolean }> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.isActive !== undefined) {
      sets.push(`is_active = $${idx++}`);
      values.push(data.isActive);
    }
    if (data.config !== undefined) {
      sets.push(`config = $${idx++}`);
      values.push(JSON.stringify(data.config));
    }

    if (!sets.length) return { ...SUCCESS };

    sets.push(`updated_at = NOW()`);
    values.push(provisionerId);

    await this.pool.query(
      `UPDATE provisioners SET ${sets.join(', ')} WHERE provisioner_id = $${idx}`,
      values,
    );
    return { ...SUCCESS };
  }

  async deactivate(provisionerId: string): Promise<{ success: boolean }> {
    await this.pool.query(
      'UPDATE provisioners SET is_active = false, updated_at = NOW() WHERE provisioner_id = $1',
      [provisionerId],
    );
    return { ...SUCCESS };
  }
}

function mapRow(row: any): ProvisionerRow {
  return {
    provisionerId: row.provisioner_id,
    name: row.name,
    isActive: row.is_active,
    config: row.config ?? {},
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  };
}
