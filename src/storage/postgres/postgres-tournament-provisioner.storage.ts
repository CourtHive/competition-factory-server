import { commandClient } from './commandTransaction';
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import {
  ITournamentProvisionerStorage,
  TournamentProvisionerRow,
} from '../interfaces/tournament-provisioner-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresTournamentProvisionerStorage implements ITournamentProvisionerStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getByTournament(tournamentId: string): Promise<TournamentProvisionerRow | null> {
    const result = await (commandClient(this.pool) ?? this.pool).query(
      'SELECT tournament_id, provisioner_id, provider_id, created_at FROM tournament_provisioner WHERE tournament_id = $1',
      [tournamentId],
    );
    return result.rows.length ? mapRow(result.rows[0]) : null;
  }

  async getByProvisioner(provisionerId: string, providerId?: string): Promise<TournamentProvisionerRow[]> {
    if (providerId) {
      const result = await (commandClient(this.pool) ?? this.pool).query(
        `SELECT tournament_id, provisioner_id, provider_id, created_at
         FROM tournament_provisioner
         WHERE provisioner_id = $1 AND provider_id = $2
         ORDER BY created_at`,
        [provisionerId, providerId],
      );
      return result.rows.map(mapRow);
    }
    const result = await (commandClient(this.pool) ?? this.pool).query(
      `SELECT tournament_id, provisioner_id, provider_id, created_at
       FROM tournament_provisioner
       WHERE provisioner_id = $1
       ORDER BY created_at`,
      [provisionerId],
    );
    return result.rows.map(mapRow);
  }

  async create(row: Omit<TournamentProvisionerRow, 'createdAt'>): Promise<{ success: boolean }> {
    await (commandClient(this.pool) ?? this.pool).query(
      `INSERT INTO tournament_provisioner (tournament_id, provisioner_id, provider_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tournament_id) DO NOTHING`,
      [row.tournamentId, row.provisionerId, row.providerId],
    );
    return { ...SUCCESS };
  }

  async reassign(
    tournamentId: string,
    to: { provisionerId: string; providerId: string },
  ): Promise<{ success: boolean }> {
    const result = await (commandClient(this.pool) ?? this.pool).query(
      'UPDATE tournament_provisioner SET provisioner_id = $2, provider_id = $3 WHERE tournament_id = $1',
      [tournamentId, to.provisionerId, to.providerId],
    );
    return { success: (result.rowCount ?? 0) > 0 };
  }

  async remove(tournamentId: string): Promise<{ success: boolean }> {
    await (commandClient(this.pool) ?? this.pool).query('DELETE FROM tournament_provisioner WHERE tournament_id = $1', [
      tournamentId,
    ]);
    return { ...SUCCESS };
  }
}

function mapRow(row: any): TournamentProvisionerRow {
  return {
    tournamentId: row.tournament_id,
    provisionerId: row.provisioner_id,
    providerId: row.provider_id,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}
