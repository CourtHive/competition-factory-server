import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import {
  GetPolicyArgs,
  IPolicyStorage,
  ListPoliciesArgs,
  PolicyRecord,
  PolicyVisibility,
  SavePolicyInput,
} from '../interfaces/policy-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

const COLS =
  'policy_id, provider_id, policy_type, name, version, visibility, definition, metadata, published_at, published_by';

@Injectable()
export class PostgresPolicyStorage implements IPolicyStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async savePolicy(input: SavePolicyInput): Promise<{ success?: boolean; error?: string }> {
    await this.pool.query(
      `INSERT INTO policies (policy_id, provider_id, policy_type, name, version, visibility, definition, metadata, published_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.policyId,
        input.providerId,
        input.policyType,
        input.name,
        input.version,
        input.visibility,
        JSON.stringify(input.definition),
        input.metadata != null ? JSON.stringify(input.metadata) : null,
        input.publishedBy ?? null,
      ],
    );
    return { ...SUCCESS };
  }

  async findById(policyId: string): Promise<{ policy?: PolicyRecord; error?: string }> {
    const result = await this.pool.query(
      `SELECT ${COLS} FROM policies WHERE policy_id = $1 AND deleted_at IS NULL`,
      [policyId],
    );
    if (!result.rows.length) return {};
    return { policy: mapRow(result.rows[0]) };
  }

  async getPolicy({
    policyType,
    name,
    version,
    providerId,
  }: GetPolicyArgs): Promise<{ policy?: PolicyRecord; error?: string }> {
    const conditions: string[] = ['policy_type = $1', 'name = $2', 'deleted_at IS NULL'];
    const values: any[] = [policyType, name];

    if (providerId !== undefined) {
      conditions.push(providerId === null ? 'provider_id IS NULL' : `provider_id = $${values.length + 1}`);
      if (providerId !== null) values.push(providerId);
    }

    if (version) {
      conditions.push(`version = $${values.length + 1}`);
      values.push(version);
    }

    const sql = `SELECT ${COLS} FROM policies WHERE ${conditions.join(' AND ')} ORDER BY published_at DESC LIMIT 1`;
    const result = await this.pool.query(sql, values);
    if (!result.rows.length) return {};
    return { policy: mapRow(result.rows[0]) };
  }

  async listPolicies(args: ListPoliciesArgs): Promise<{ policies?: PolicyRecord[]; error?: string }> {
    const { providerId, visibilities, policyType, includeGlobal } = args;
    const conditions: string[] = ['deleted_at IS NULL'];
    const values: any[] = [];

    if (providerId !== undefined) {
      if (providerId === null) {
        conditions.push('provider_id IS NULL');
      } else if (includeGlobal) {
        conditions.push(`(provider_id = $${values.length + 1} OR provider_id IS NULL)`);
        values.push(providerId);
      } else {
        conditions.push(`provider_id = $${values.length + 1}`);
        values.push(providerId);
      }
    }

    if (visibilities?.length) {
      const placeholders = visibilities.map((_, i) => `$${values.length + i + 1}`).join(', ');
      conditions.push(`visibility IN (${placeholders})`);
      values.push(...visibilities);
    }

    if (policyType) {
      conditions.push(`policy_type = $${values.length + 1}`);
      values.push(policyType);
    }

    const sql = `SELECT ${COLS} FROM policies WHERE ${conditions.join(' AND ')} ORDER BY policy_type, name, published_at DESC`;
    const result = await this.pool.query(sql, values);
    return { policies: result.rows.map(mapRow) };
  }

  async deletePolicy({ policyId }: { policyId: string }): Promise<{ success?: boolean; error?: string }> {
    await this.pool.query('UPDATE policies SET deleted_at = now() WHERE policy_id = $1 AND deleted_at IS NULL', [
      policyId,
    ]);
    return { ...SUCCESS };
  }
}

function mapRow(row: any): PolicyRecord {
  return {
    policyId: row.policy_id,
    providerId: row.provider_id,
    policyType: row.policy_type,
    name: row.name,
    version: row.version,
    visibility: row.visibility as PolicyVisibility,
    definition: row.definition,
    metadata: row.metadata,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
  };
}
