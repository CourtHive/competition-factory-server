import { Injectable } from '@nestjs/common';

import { ITournamentProvisionerStorage, TournamentProvisionerRow } from '../interfaces/tournament-provisioner-storage.interface';

const MSG = 'tournament_provisioner requires Postgres. Set STORAGE_PROVIDER=postgres in .env';

/**
 * LevelDB stub — tournament_provisioner is a Postgres-only feature.
 * Throws on every call so misconfigured deployments fail loudly.
 */
@Injectable()
export class LeveldbTournamentProvisionerStorage implements ITournamentProvisionerStorage {
  async getByTournament(): Promise<TournamentProvisionerRow | null> { throw new Error(MSG); }
  async getByProvisioner(): Promise<TournamentProvisionerRow[]> { throw new Error(MSG); }
  async create(): Promise<{ success: boolean }> { throw new Error(MSG); }
  async remove(): Promise<{ success: boolean }> { throw new Error(MSG); }
}
