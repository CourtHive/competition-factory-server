import { Injectable } from '@nestjs/common';

import { ISsoIdentityStorage, SsoIdentityRow } from '../interfaces/sso-identity-storage.interface';

const MSG = 'sso_identities requires Postgres. Set STORAGE_PROVIDER=postgres in .env';

/**
 * LevelDB stub — sso_identities is a Postgres-only feature.
 * Throws on every call so misconfigured deployments fail loudly.
 */
@Injectable()
export class LeveldbSsoIdentityStorage implements ISsoIdentityStorage {
  async findByExternalId(): Promise<SsoIdentityRow | null> { throw new Error(MSG); }
  async findByUserId(): Promise<SsoIdentityRow[]> { throw new Error(MSG); }
  async create(): Promise<{ success: boolean }> { throw new Error(MSG); }
  async update(): Promise<{ success: boolean }> { throw new Error(MSG); }
  async remove(): Promise<{ success: boolean }> { throw new Error(MSG); }
}
