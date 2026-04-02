import { IOfficiatingStorage } from '../interfaces/officiating-storage.interface';
import { SUCCESS } from 'src/common/constants/app';
import netLevel from 'src/services/levelDB/netLevel';
import { Injectable } from '@nestjs/common';

const BASE_OFFICIATING = 'officialRecord';

@Injectable()
export class LeveldbOfficiatingStorage implements IOfficiatingStorage {
  async findOfficialRecord({ officialRecordId }: { officialRecordId: string }) {
    const officialRecord = await netLevel.get(BASE_OFFICIATING, { key: officialRecordId });
    if (!officialRecord) return { error: 'Official record not found' };
    return { officialRecord };
  }

  async fetchOfficialRecords(params?: { providerId?: string }) {
    const keysValues = (await netLevel.keys(BASE_OFFICIATING, { from: 0 })) as Array<any>;
    const ids = keysValues?.map((kv: any) => kv.key)?.filter(Boolean) ?? [];

    const officialRecords: any[] = [];
    for (const id of ids) {
      const record: any = await netLevel.get(BASE_OFFICIATING, { key: id });
      if (record) {
        if (params?.providerId && record.providerId !== params.providerId) continue;
        officialRecords.push(record);
      }
    }

    return { ...SUCCESS, officialRecords };
  }

  async saveOfficialRecord({ officialRecord }: { officialRecord: any }) {
    const key = officialRecord?.officialRecordId;
    if (!key) return { error: 'Invalid officialRecord' };
    await netLevel.set(BASE_OFFICIATING, { key, value: officialRecord });
    return { ...SUCCESS };
  }

  async removeOfficialRecord({ officialRecordId }: { officialRecordId: string }) {
    if (!officialRecordId) return { error: 'Missing officialRecordId' };
    await netLevel.delete(BASE_OFFICIATING, { key: officialRecordId });
    return { ...SUCCESS };
  }

  async listOfficialRecordIds(params?: { providerId?: string }): Promise<string[]> {
    const keysValues = (await netLevel.keys(BASE_OFFICIATING, { from: 0 })) as Array<any>;
    const ids = keysValues?.map((kv: any) => kv.key)?.filter(Boolean) ?? [];

    if (!params?.providerId) return ids;

    const filtered: string[] = [];
    for (const id of ids) {
      const record: any = await netLevel.get(BASE_OFFICIATING, { key: id });
      if (record?.providerId === params.providerId) filtered.push(id);
    }
    return filtered;
  }
}
