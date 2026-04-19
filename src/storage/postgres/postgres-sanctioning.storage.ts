import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { ISanctioningStorage } from '../interfaces/sanctioning-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresSanctioningStorage implements ISanctioningStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findSanctioningRecord({ sanctioningId }: { sanctioningId: string }) {
    const result = await this.pool.query(
      'SELECT data FROM sanctioning_records WHERE sanctioning_id = $1',
      [sanctioningId],
    );
    if (result.rows.length === 0) return { error: 'Sanctioning record not found' };
    return { sanctioningRecord: result.rows[0].data };
  }

  async fetchSanctioningRecords(params?: { providerId?: string }) {
    let result;
    if (params?.providerId) {
      result = await this.pool.query(
        'SELECT data FROM sanctioning_records WHERE applicant_provider_id = $1',
        [params.providerId],
      );
    } else {
      result = await this.pool.query('SELECT data FROM sanctioning_records');
    }
    return { ...SUCCESS, sanctioningRecords: result.rows.map((r) => r.data) };
  }

  async saveSanctioningRecord({ sanctioningRecord }: { sanctioningRecord: any }) {
    const key = sanctioningRecord?.sanctioningId;
    if (!key) return { error: 'Invalid sanctioningRecord' };
    await this.pool.query(
      `INSERT INTO sanctioning_records (sanctioning_id, applicant_provider_id, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (sanctioning_id) DO UPDATE SET applicant_provider_id = $2, data = $3`,
      [key, sanctioningRecord.applicantProviderId ?? null, JSON.stringify(sanctioningRecord)],
    );
    return { ...SUCCESS };
  }

  async removeSanctioningRecord({ sanctioningId }: { sanctioningId: string }) {
    if (!sanctioningId) return { error: 'Missing sanctioningId' };
    await this.pool.query('DELETE FROM sanctioning_records WHERE sanctioning_id = $1', [sanctioningId]);
    return { ...SUCCESS };
  }

  async listSanctioningIds(params?: { providerId?: string }): Promise<string[]> {
    let result;
    if (params?.providerId) {
      result = await this.pool.query(
        'SELECT sanctioning_id FROM sanctioning_records WHERE applicant_provider_id = $1',
        [params.providerId],
      );
    } else {
      result = await this.pool.query('SELECT sanctioning_id FROM sanctioning_records');
    }
    return result.rows.map((r) => r.sanctioning_id);
  }
}
