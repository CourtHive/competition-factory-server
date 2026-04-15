import { Injectable } from '@nestjs/common';

import { IProvisionerProviderStorage, ProvisionerProviderRow } from '../interfaces/provisioner-provider-storage.interface';

const MSG = 'provisioner_providers requires Postgres. Set STORAGE_PROVIDER=postgres in .env';

/**
 * LevelDB stub — provisioner_providers is a Postgres-only feature.
 * Throws on every call so misconfigured deployments fail loudly.
 */
@Injectable()
export class LeveldbProvisionerProviderStorage implements IProvisionerProviderStorage {
  async findByProvisioner(): Promise<ProvisionerProviderRow[]> { throw new Error(MSG); }
  async findByProvider(): Promise<ProvisionerProviderRow[]> { throw new Error(MSG); }
  async getRelationship(): Promise<'owner' | 'subsidiary' | null> { throw new Error(MSG); }
  async associate(): Promise<{ success: boolean }> { throw new Error(MSG); }
  async updateRelationship(): Promise<{ success: boolean }> { throw new Error(MSG); }
  async disassociate(): Promise<{ success: boolean }> { throw new Error(MSG); }
}
