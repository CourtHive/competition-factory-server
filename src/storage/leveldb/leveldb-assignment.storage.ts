import { Injectable } from '@nestjs/common';

import { IAssignmentStorage, TournamentAssignmentRow } from '../interfaces/assignment-storage.interface';

const MSG = 'tournament_assignments requires Postgres. Set STORAGE_PROVIDER=postgres in .env';

/**
 * LevelDB stub — tournament_assignments is a Postgres-only feature.
 * Throws on every call so misconfigured deployments fail loudly.
 */
@Injectable()
export class LeveldbAssignmentStorage implements IAssignmentStorage {
  async findByTournamentId(): Promise<TournamentAssignmentRow[]> { throw new Error(MSG); }
  async findByUserId(): Promise<TournamentAssignmentRow[]> { throw new Error(MSG); }
  async findOne(): Promise<TournamentAssignmentRow | null> { throw new Error(MSG); }
  async grant(): Promise<{ success: boolean }> { throw new Error(MSG); }
  async revoke(): Promise<{ success: boolean }> { throw new Error(MSG); }
}
