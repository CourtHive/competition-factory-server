import { commandClient } from './commandTransaction';
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IProviderStorage } from '../interfaces/provider-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

/** Keys a patch never writes into `data`: identity, and the fields that live in their own columns. */
const NON_DATA_PATCH_KEYS = new Set(['organisationId', 'providerId', 'organisationAbbreviation', 'organisationName']);

@Injectable()
export class PostgresProviderStorage implements IProviderStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getProvider(providerId: string): Promise<any> {
    const result = await (commandClient(this.pool) ?? this.pool).query(
      'SELECT provider_id, organisation_abbreviation, organisation_name, data FROM providers WHERE provider_id = $1',
      [providerId],
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    // Spread `data` first so canonical column-derived fields win on conflict.
    // Earlier ordering let stale `data.organisationId` etc. shadow the columns.
    return {
      ...row.data,
      organisationId: row.provider_id,
      organisationAbbreviation: row.organisation_abbreviation,
      organisationName: row.organisation_name,
    };
  }

  async getProviders(): Promise<{ key: string; value: any }[]> {
    const result = await (commandClient(this.pool) ?? this.pool).query(
      'SELECT provider_id, organisation_abbreviation, organisation_name, data, last_access FROM providers',
    );
    return result.rows.map((row) => ({
      key: row.provider_id,
      // Spread `data` first so canonical column-derived fields win on conflict.
      // Without this, a stale `data.lastAccess` (left over from a pre-column
      // write path) would shadow `last_access` and the admin UI would show
      // a months-old timestamp despite the column being correctly updated.
      value: {
        ...row.data,
        organisationId: row.provider_id,
        organisationAbbreviation: row.organisation_abbreviation,
        organisationName: row.organisation_name,
        lastAccess: row.last_access,
      },
    }));
  }

  async updateLastAccess(providerId: string): Promise<void> {
    await (commandClient(this.pool) ?? this.pool).query(
      'UPDATE providers SET last_access = NOW() WHERE provider_id = $1',
      [providerId],
    );
  }

  async updateLastAccessByTournament(tournamentId: string): Promise<void> {
    // Single round-trip JOIN — bumps the owning provider's last_access
    // without a separate fetch. Silently no-op when the tournament row
    // exists but has no provider_id (legacy data) or doesn't exist.
    await (commandClient(this.pool) ?? this.pool).query(
      `UPDATE providers
         SET last_access = NOW()
         FROM tournaments
         WHERE providers.provider_id = tournaments.provider_id
           AND tournaments.tournament_id = $1`,
      [tournamentId],
    );
  }

  async removeProvider(providerId: string): Promise<{ success: boolean }> {
    await (commandClient(this.pool) ?? this.pool).query('DELETE FROM providers WHERE provider_id = $1', [providerId]);
    return { ...SUCCESS };
  }

  async setProvider(providerId: string, provider: any): Promise<{ success: boolean }> {
    const { organisationAbbreviation, organisationName, ...rest } = provider;
    await (commandClient(this.pool) ?? this.pool).query(
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

  async patchProvider(providerId: string, patch: Record<string, any>): Promise<{ success: boolean }> {
    if (!providerId) return { success: false };
    const supplied = Object.entries(patch ?? {}).filter(([, value]) => value !== undefined);
    const fields = Object.fromEntries(supplied);
    const dataPatch = Object.fromEntries(supplied.filter(([key]) => !NON_DATA_PATCH_KEYS.has(key)));
    // `||` replaces only the top-level keys in the patch, against the row as it is when the UPDATE
    // runs — so a key written concurrently by a narrower path is never overwritten with a stale copy.
    const result = await (commandClient(this.pool) ?? this.pool).query(
      `UPDATE providers
         SET organisation_abbreviation = CASE WHEN $2::boolean THEN $3::text ELSE organisation_abbreviation END,
             organisation_name = CASE WHEN $4::boolean THEN $5::text ELSE organisation_name END,
             data = COALESCE(data, '{}'::jsonb) || $6::jsonb,
             updated_at = NOW()
       WHERE provider_id = $1`,
      [
        providerId,
        'organisationAbbreviation' in fields,
        fields.organisationAbbreviation ?? '',
        'organisationName' in fields,
        fields.organisationName ?? null,
        JSON.stringify(dataPatch),
      ],
    );
    return { success: (result.rowCount ?? 0) > 0 };
  }

  async updateProviderCaps(providerId: string, caps: any): Promise<{ success: boolean }> {
    await (commandClient(this.pool) ?? this.pool).query(
      `UPDATE providers
         SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{providerConfigCaps}', $2::jsonb, true),
             updated_at = NOW()
       WHERE provider_id = $1`,
      [providerId, JSON.stringify(caps ?? {})],
    );
    return { ...SUCCESS };
  }

  async updateProviderSettings(providerId: string, settings: any): Promise<{ success: boolean }> {
    await (commandClient(this.pool) ?? this.pool).query(
      `UPDATE providers
         SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{providerConfigSettings}', $2::jsonb, true),
             updated_at = NOW()
       WHERE provider_id = $1`,
      [providerId, JSON.stringify(settings ?? {})],
    );
    return { ...SUCCESS };
  }
}
