import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IProviderStorage } from '../interfaces/provider-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresProviderStorage implements IProviderStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getProvider(providerId: string): Promise<any | null> {
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
      'SELECT provider_id, organisation_abbreviation, organisation_name, data FROM providers',
    );
    return result.rows.map((row) => ({
      key: row.provider_id,
      value: {
        organisationId: row.provider_id,
        organisationAbbreviation: row.organisation_abbreviation,
        organisationName: row.organisation_name,
        ...row.data,
      },
    }));
  }

  async setProvider(providerId: string, provider: any): Promise<{ success: boolean }> {
    const { organisationAbbreviation, organisationName, organisationId, ...rest } = provider;
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
}
