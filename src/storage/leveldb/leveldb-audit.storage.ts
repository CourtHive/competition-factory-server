import { Injectable } from '@nestjs/common';

import { IAuditStorage, AuditRow } from '../interfaces/audit-storage.interface';

const MSG = 'audit_log requires Postgres. Set STORAGE_PROVIDER=postgres in .env';

/**
 * LevelDB stub — audit log is a Postgres-only feature.
 * Throws on every call so misconfigured deployments fail loudly.
 */
@Injectable()
export class LeveldbAuditStorage implements IAuditStorage {
  async append(): Promise<void> { throw new Error(MSG); }
  async findByTournamentId(): Promise<AuditRow[]> { throw new Error(MSG); }
  async findByActionType(): Promise<AuditRow[]> { throw new Error(MSG); }
  async prune(): Promise<number> { throw new Error(MSG); }
}
