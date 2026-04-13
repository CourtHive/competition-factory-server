import { Injectable } from '@nestjs/common';

import { IUserProviderStorage, UserProviderRow } from '../interfaces/user-provider-storage.interface';

const MSG = 'user_providers requires Postgres. Set STORAGE_PROVIDER=postgres in .env';

/**
 * LevelDB stub — user_providers is a Postgres-only feature.
 * Throws on every call so misconfigured deployments fail loudly.
 */
@Injectable()
export class LeveldbUserProviderStorage implements IUserProviderStorage {
  async findByUserId(): Promise<UserProviderRow[]> { throw new Error(MSG); }
  async findByEmail(): Promise<UserProviderRow[]> { throw new Error(MSG); }
  async findByProviderId(): Promise<UserProviderRow[]> { throw new Error(MSG); }
  async findOne(): Promise<UserProviderRow | null> { throw new Error(MSG); }
  async upsert(): Promise<{ success: boolean }> { throw new Error(MSG); }
  async remove(): Promise<{ success: boolean }> { throw new Error(MSG); }
}
