import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import {
  ITopologyStorage,
  TopologyRow,
} from '../interfaces/topology-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

const COLS =
  'topology_id, provider_id, name, description, state, created_at, updated_at';

@Injectable()
export class PostgresTopologyStorage implements ITopologyStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findByProvider(providerId: string): Promise<TopologyRow[]> {
    const result = await this.pool.query(
      `SELECT ${COLS} FROM provider_topologies WHERE provider_id = $1 ORDER BY name`,
      [providerId],
    );
    return result.rows.map(mapRow);
  }

  async getOne(providerId: string, topologyId: string): Promise<TopologyRow | null> {
    const result = await this.pool.query(
      `SELECT ${COLS} FROM provider_topologies WHERE provider_id = $1 AND topology_id = $2`,
      [providerId, topologyId],
    );
    return result.rows.length ? mapRow(result.rows[0]) : null;
  }

  async create(
    row: Omit<TopologyRow, 'createdAt' | 'updatedAt'>,
  ): Promise<TopologyRow> {
    const result = await this.pool.query(
      `INSERT INTO provider_topologies (topology_id, provider_id, name, description, state)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLS}`,
      [
        row.topologyId,
        row.providerId,
        row.name,
        row.description ?? null,
        JSON.stringify(row.state),
      ],
    );
    return mapRow(result.rows[0]);
  }

  async update(
    providerId: string,
    topologyId: string,
    patch: Partial<Pick<TopologyRow, 'name' | 'description' | 'state'>>,
  ): Promise<{ success: boolean }> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (patch.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push(`description = $${idx++}`);
      values.push(patch.description);
    }
    if (patch.state !== undefined) {
      sets.push(`state = $${idx++}`);
      values.push(JSON.stringify(patch.state));
    }

    if (!sets.length) return { ...SUCCESS };

    sets.push('updated_at = NOW()');
    values.push(providerId, topologyId);

    await this.pool.query(
      `UPDATE provider_topologies SET ${sets.join(', ')}
       WHERE provider_id = $${idx++} AND topology_id = $${idx}`,
      values,
    );
    return { ...SUCCESS };
  }

  async remove(providerId: string, topologyId: string): Promise<{ success: boolean }> {
    await this.pool.query(
      'DELETE FROM provider_topologies WHERE provider_id = $1 AND topology_id = $2',
      [providerId, topologyId],
    );
    return { ...SUCCESS };
  }
}

function mapRow(row: any): TopologyRow {
  return {
    topologyId: row.topology_id,
    providerId: row.provider_id,
    name: row.name,
    description: row.description,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
