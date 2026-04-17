import { Injectable } from '@nestjs/common';

import { IProvisionerApiKeyStorage, ProvisionerApiKeyRow } from '../interfaces/provisioner-api-key-storage.interface';

const MSG = 'provisioner_api_keys requires Postgres. Set STORAGE_PROVIDER=postgres in .env';

/**
 * LevelDB stub — provisioner_api_keys is a Postgres-only feature.
 * Throws on every call so misconfigured deployments fail loudly.
 */
@Injectable()
export class LeveldbProvisionerApiKeyStorage implements IProvisionerApiKeyStorage {
  async findByKeyHash(): Promise<{ key: ProvisionerApiKeyRow; provisionerName: string; provisionerConfig: Record<string, any> } | null> { throw new Error(MSG); }
  async create(): Promise<ProvisionerApiKeyRow> { throw new Error(MSG); }
  async revoke(): Promise<{ success: boolean }> { throw new Error(MSG); }
  async listByProvisioner(): Promise<ProvisionerApiKeyRow[]> { throw new Error(MSG); }
  async updateLastUsed(): Promise<void> { throw new Error(MSG); }
}
