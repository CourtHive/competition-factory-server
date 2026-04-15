import { Injectable } from '@nestjs/common';

import { IProvisionerStorage, ProvisionerRow } from '../interfaces/provisioner-storage.interface';

const MSG = 'provisioners requires Postgres. Set STORAGE_PROVIDER=postgres in .env';

/**
 * LevelDB stub — provisioners is a Postgres-only feature.
 * Throws on every call so misconfigured deployments fail loudly.
 */
@Injectable()
export class LeveldbProvisionerStorage implements IProvisionerStorage {
  async getProvisioner(): Promise<ProvisionerRow | null> { throw new Error(MSG); }
  async findByName(): Promise<ProvisionerRow | null> { throw new Error(MSG); }
  async findAll(): Promise<ProvisionerRow[]> { throw new Error(MSG); }
  async create(): Promise<ProvisionerRow> { throw new Error(MSG); }
  async update(): Promise<{ success: boolean }> { throw new Error(MSG); }
  async deactivate(): Promise<{ success: boolean }> { throw new Error(MSG); }
}
