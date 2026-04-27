import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IProviderStorage } from '../interfaces/provider-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresProviderStorage implements IProviderStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getProvider(providerId: string): Promise<any> {
    const result = await this.pool.query(
      'SELECT provider_id, organisation_abbreviation, organisation_name, data FROM providers WHERE provider_id = $1',
      [providerId],
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
      organisationId: row.provider_id,
      organisationAbbreviation: row.organisation_abbreviation,
      organisationName: row.organisation_name,
      ...row.data,
    };
  }

  async getProviders(): Promise<{ key: string; value: any }[]> {
    const result = await this.pool.query(
      'SELECT provider_id, organisation_abbreviation, organisation_name, data, last_access FROM providers',
    );
    return result.rows.map((row) => ({
      key: row.provider_id,
      value: {
        organisationId: row.provider_id,
        organisationAbbreviation: row.organisation_abbreviation,
        organisationName: row.organisation_name,
        lastAccess: row.last_access,
        ...row.data,
      },
    }));
  }

  async updateLastAccess(providerId: string): Promise<void> {
    await this.pool.query('UPDATE providers SET last_access = NOW() WHERE provider_id = $1', [providerId]);
  }

  async removeProvider(providerId: string): Promise<{ success: boolean }> {
    await this.pool.query('DELETE FROM providers WHERE provider_id = $1', [providerId]);
    return { ...SUCCESS };
  }

  async setProvider(providerId: string, provider: any): Promise<{ success: boolean }> {
    const { organisationAbbreviation, organisationName, ...rest } = provider;
    await this.pool.query(
      `INSERT INTO providers (provider_id, organisation_abbreviation, organisation_name, data)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider_id) DO UPDATE SET
         organisation_abbreviation = EXCLUDED.organisation_abbreviation,
         organisation_name = EXCLUDED.organisation_name,
         data = EXCLUDED.data,
         updated_at = NOW()`,
      [providerId, organisationAbbreviation ?? '', organisationName ?? null, JSON.stringify(rest)],
    );
    return { ...SUCCESS };
  }

  async updateProviderCaps(providerId: string, caps: any): Promise<{ success: boolean }> {
    await this.pool.query(
      `UPDATE providers
         SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{providerConfigCaps}', $2::jsonb, true),
             updated_at = NOW()
       WHERE provider_id = $1`,
      [providerId, JSON.stringify(caps ?? {})],
    );
    return { ...SUCCESS };
  }

  async updateProviderSettings(providerId: string, settings: any): Promise<{ success: boolean }> {
    await this.pool.query(
      `UPDATE providers
         SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{providerConfigSettings}', $2::jsonb, true),
             updated_at = NOW()
       WHERE provider_id = $1`,
      [providerId, JSON.stringify(settings ?? {})],
    );
    return { ...SUCCESS };
  }
}
