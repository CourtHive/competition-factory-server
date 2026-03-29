import { ISanctioningStorage } from '../interfaces/sanctioning-storage.interface';
import netLevel from 'src/services/levelDB/netLevel';
import { Injectable } from '@nestjs/common';

import { SUCCESS } from 'src/common/constants/app';

const BASE_SANCTIONING = 'sanctioningRecord';

@Injectable()
export class LeveldbSanctioningStorage implements ISanctioningStorage {
  async findSanctioningRecord({ sanctioningId }: { sanctioningId: string }) {
    const sanctioningRecord = await netLevel.get(BASE_SANCTIONING, { key: sanctioningId });
    if (!sanctioningRecord) return { error: 'Sanctioning record not found' };
    return { sanctioningRecord };
  }

  async fetchSanctioningRecords(params?: { providerId?: string }) {
    const keysValues = (await netLevel.keys(BASE_SANCTIONING, { from: 0 })) as Array<any>;
    const ids = keysValues?.map((kv: any) => kv.key)?.filter(Boolean) ?? [];

    const sanctioningRecords: any[] = [];
    for (const id of ids) {
      const record: any = await netLevel.get(BASE_SANCTIONING, { key: id });
      if (record) {
        // Filter by applicantProviderId (the operator/club that owns the record)
        if (params?.providerId && record.applicantProviderId !== params.providerId) continue;
        sanctioningRecords.push(record);
      }
    }

    return { ...SUCCESS, sanctioningRecords };
  }

  async saveSanctioningRecord({ sanctioningRecord }: { sanctioningRecord: any }) {
    const key = sanctioningRecord?.sanctioningId;
    if (!key) return { error: 'Invalid sanctioningRecord' };
    await netLevel.set(BASE_SANCTIONING, { key, value: sanctioningRecord });
    return { ...SUCCESS };
  }

  async removeSanctioningRecord({ sanctioningId }: { sanctioningId: string }) {
    if (!sanctioningId) return { error: 'Missing sanctioningId' };
    await netLevel.delete(BASE_SANCTIONING, { key: sanctioningId });
    return { ...SUCCESS };
  }

  async listSanctioningIds(params?: { providerId?: string }): Promise<string[]> {
    const keysValues = (await netLevel.keys(BASE_SANCTIONING, { from: 0 })) as Array<any>;
    const ids = keysValues?.map((kv: any) => kv.key)?.filter(Boolean) ?? [];

    if (!params?.providerId) return ids;

    const filtered: string[] = [];
    for (const id of ids) {
      const record: any = await netLevel.get(BASE_SANCTIONING, { key: id });
      if (record?.applicantProviderId === params.providerId) filtered.push(id);
    }
    return filtered;
  }
}
