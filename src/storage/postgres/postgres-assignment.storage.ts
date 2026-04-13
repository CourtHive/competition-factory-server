import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { IAssignmentStorage, TournamentAssignmentRow } from '../interfaces/assignment-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

@Injectable()
export class PostgresAssignmentStorage implements IAssignmentStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findByTournamentId(tournamentId: string): Promise<TournamentAssignmentRow[]> {
    const result = await this.pool.query(
      `SELECT ta.tournament_id, ta.user_id, ta.provider_id, ta.assignment_role, ta.granted_by, ta.granted_at, u.email
       FROM tournament_assignments ta
       JOIN users u ON u.user_id = ta.user_id
       WHERE ta.tournament_id = $1
       ORDER BY ta.granted_at`,
      [tournamentId],
    );
    return result.rows.map(mapRow);
  }

  async findByUserId(userId: string, providerId?: string): Promise<TournamentAssignmentRow[]> {
    if (providerId) {
      const result = await this.pool.query(
        `SELECT ta.tournament_id, ta.user_id, ta.provider_id, ta.assignment_role, ta.granted_by, ta.granted_at, u.email
         FROM tournament_assignments ta
         JOIN users u ON u.user_id = ta.user_id
         WHERE ta.user_id = $1 AND ta.provider_id = $2
         ORDER BY ta.granted_at`,
        [userId, providerId],
      );
      return result.rows.map(mapRow);
    }
    const result = await this.pool.query(
      `SELECT ta.tournament_id, ta.user_id, ta.provider_id, ta.assignment_role, ta.granted_by, ta.granted_at, u.email
       FROM tournament_assignments ta
       JOIN users u ON u.user_id = ta.user_id
       WHERE ta.user_id = $1
       ORDER BY ta.granted_at`,
      [userId],
    );
    return result.rows.map(mapRow);
  }

  async findOne(tournamentId: string, userId: string): Promise<TournamentAssignmentRow | null> {
    const result = await this.pool.query(
      `SELECT ta.tournament_id, ta.user_id, ta.provider_id, ta.assignment_role, ta.granted_by, ta.granted_at, u.email
       FROM tournament_assignments ta
       JOIN users u ON u.user_id = ta.user_id
       WHERE ta.tournament_id = $1 AND ta.user_id = $2`,
      [tournamentId, userId],
    );
    return result.rows.length ? mapRow(result.rows[0]) : null;
  }

  async grant(row: TournamentAssignmentRow): Promise<{ success: boolean }> {
    await this.pool.query(
      `INSERT INTO tournament_assignments (tournament_id, user_id, provider_id, assignment_role, granted_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tournament_id, user_id) DO NOTHING`,
      [row.tournamentId, row.userId, row.providerId, row.assignmentRole, row.grantedBy],
    );
    return { ...SUCCESS };
  }

  async revoke(tournamentId: string, userId: string): Promise<{ success: boolean }> {
    await this.pool.query(
      'DELETE FROM tournament_assignments WHERE tournament_id = $1 AND user_id = $2',
      [tournamentId, userId],
    );
    return { ...SUCCESS };
  }
}

function mapRow(row: any): TournamentAssignmentRow {
  return {
    tournamentId: row.tournament_id,
    userId: row.user_id,
    providerId: row.provider_id,
    assignmentRole: row.assignment_role,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at?.toISOString?.() ?? row.granted_at,
    email: row.email,
  };
}
