import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import {
  IUserProvisionerStorage,
  UserProvisionerRow,
} from '../interfaces/user-provisioner-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresUserProvisionerStorage implements IUserProvisionerStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findProvisionerIdsByUser(userId: string): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT provisioner_id FROM user_provisioners WHERE user_id = $1',
      [userId],
    );
    return result.rows.map((r: any) => r.provisioner_id);
  }

  async findUsersByProvisioner(provisionerId: string): Promise<UserProvisionerRow[]> {
    const result = await this.pool.query(
      `SELECT user_id, provisioner_id, granted_by, created_at
       FROM user_provisioners
       WHERE provisioner_id = $1
       ORDER BY created_at`,
      [provisionerId],
    );
    return result.rows.map(mapRow);
  }

  async associate(
    userId: string,
    provisionerId: string,
    grantedBy?: string,
  ): Promise<{ success: boolean }> {
    await this.pool.query(
      `INSERT INTO user_provisioners (user_id, provisioner_id, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, provisioner_id) DO NOTHING`,
      [userId, provisionerId, grantedBy ?? null],
    );
    return { ...SUCCESS };
  }

  async disassociate(userId: string, provisionerId: string): Promise<{ success: boolean }> {
    await this.pool.query(
      'DELETE FROM user_provisioners WHERE user_id = $1 AND provisioner_id = $2',
      [userId, provisionerId],
    );
    return { ...SUCCESS };
  }
}

function mapRow(row: any): UserProvisionerRow {
  return {
    userId: row.user_id,
    provisionerId: row.provisioner_id,
    grantedBy: row.granted_by,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}
