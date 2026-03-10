import { IProviderStorage } from '../interfaces/provider-storage.interface';
import netLevel from 'src/services/levelDB/netLevel';
import { Injectable } from '@nestjs/common';

import { BASE_PROVIDER } from 'src/services/levelDB/constants';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class LeveldbProviderStorage implements IProviderStorage {
  async getProvider(providerId: string): Promise<any | null> {
    return await netLevel.get(BASE_PROVIDER, { key: providerId });
  }

  async getProviders(): Promise<{ key: string; value: any }[]> {
    const providers = await netLevel.list(BASE_PROVIDER, { all: true });
    return (providers as any[]) ?? [];
  }

  async setProvider(providerId: string, provider: any): Promise<{ success: boolean }> {
    await netLevel.set(BASE_PROVIDER, { key: providerId, value: provider });
    return { ...SUCCESS };
  }
}
