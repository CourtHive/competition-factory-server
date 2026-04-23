import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IOfficiatingStorage } from '../interfaces/officiating-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresOfficiatingStorage implements IOfficiatingStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findOfficialRecord({ officialRecordId }: { officialRecordId: string }) {
    const result = await this.pool.query(
      'SELECT data FROM official_records WHERE official_record_id = $1',
      [officialRecordId],
    );
    if (result.rows.length === 0) return { error: 'Official record not found' };
    return { officialRecord: result.rows[0].data };
  }

  async fetchOfficialRecords(params?: { providerId?: string }) {
    let result;
    if (params?.providerId) {
      result = await this.pool.query(
        'SELECT data FROM official_records WHERE provider_id = $1',
        [params.providerId],
      );
    } else {
      result = await this.pool.query('SELECT data FROM official_records');
    }
    return { ...SUCCESS, officialRecords: result.rows.map((r) => r.data) };
  }

  async saveOfficialRecord({ officialRecord }: { officialRecord: any }) {
    const key = officialRecord?.officialRecordId;
    if (!key) return { error: 'Invalid officialRecord' };
    await this.pool.query(
      `INSERT INTO official_records (official_record_id, provider_id, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (official_record_id) DO UPDATE SET provider_id = $2, data = $3`,
      [key, officialRecord.providerId ?? null, JSON.stringify(officialRecord)],
    );
    return { ...SUCCESS };
  }

  async removeOfficialRecord({ officialRecordId }: { officialRecordId: string }) {
    if (!officialRecordId) return { error: 'Missing officialRecordId' };
    await this.pool.query('DELETE FROM official_records WHERE official_record_id = $1', [officialRecordId]);
    return { ...SUCCESS };
  }

  async listOfficialRecordIds(params?: { providerId?: string }): Promise<string[]> {
    let result;
    if (params?.providerId) {
      result = await this.pool.query(
        'SELECT official_record_id FROM official_records WHERE provider_id = $1',
        [params.providerId],
      );
    } else {
      result = await this.pool.query('SELECT official_record_id FROM official_records');
    }
    return result.rows.map((r) => r.official_record_id);
  }
}
