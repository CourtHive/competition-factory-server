import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { ICalendarStorage } from '../interfaces/calendar-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresCalendarStorage implements ICalendarStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getCalendar(providerAbbr: string): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT provider_abbr, provider, tournaments FROM calendars WHERE provider_abbr = $1',
      [providerAbbr],
    );
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return { provider: row.provider, tournaments: row.tournaments };
  }

  async setCalendar(providerAbbr: string, data: any): Promise<{ success: boolean }> {
    await this.pool.query(
      `INSERT INTO calendars (provider_abbr, provider, tournaments, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (provider_abbr) DO UPDATE SET
         provider = EXCLUDED.provider,
         tournaments = EXCLUDED.tournaments,
         updated_at = NOW()`,
      [providerAbbr, JSON.stringify(data.provider), JSON.stringify(data.tournaments)],
    );
    return { ...SUCCESS };
  }

  async listCalendars(): Promise<{ key: string; value: any }[]> {
    const result = await this.pool.query('SELECT provider_abbr, provider, tournaments FROM calendars');
    return result.rows.map((row) => ({
      key: row.provider_abbr,
      value: { provider: row.provider, tournaments: row.tournaments },
    }));
  }
}
