import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import type {
  IRegistrationEntryStorage,
  RegistrationEntry,
  RegistrationEntryUpsert,
  RegistrationStatusUpdate,
} from '../interfaces/registration-entry-storage.interface';
import { PG_POOL } from './postgres.config';

const SELECT_COLUMNS = `
  registration_id, tournament_id, user_id, person_id,
  event_ids, partner_user_id, answers, status, status_reason,
  applied_at, status_at, decided_by_user_id, created_at, updated_at`;

@Injectable()
export class PostgresRegistrationEntryStorage implements IRegistrationEntryStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async applyForTournament(args: RegistrationEntryUpsert): Promise<RegistrationEntry> {
    // UPSERT keyed on (tournament_id, user_id). On conflict we move the row
    // back to `applied`, refresh status_at, and overwrite the supplied
    // fields. This handles the re-apply-after-withdrawal flow without
    // creating duplicate rows.
    const result = await this.pool.query(
      `INSERT INTO registration_entries
         (tournament_id, user_id, person_id, event_ids, partner_user_id, answers, status, status_at)
         VALUES ($1, $2, $3, COALESCE($4, ARRAY[]::text[]), $5, COALESCE($6, '{}'::jsonb), 'applied', NOW())
       ON CONFLICT (tournament_id, user_id) DO UPDATE SET
         person_id = COALESCE(EXCLUDED.person_id, registration_entries.person_id),
         event_ids = EXCLUDED.event_ids,
         partner_user_id = EXCLUDED.partner_user_id,
         answers = EXCLUDED.answers,
         status = 'applied',
         status_reason = NULL,
         status_at = NOW(),
         decided_by_user_id = NULL,
         updated_at = NOW()
       RETURNING ${SELECT_COLUMNS}`,
      [
        args.tournamentId,
        args.userId,
        args.personId ?? null,
        args.eventIds ?? null,
        args.partnerUserId ?? null,
        args.answers ? JSON.stringify(args.answers) : null,
      ],
    );
    return mapRow(result.rows[0]);
  }

  async findById(registrationId: string): Promise<RegistrationEntry | null> {
    const result = await this.pool.query(
      `SELECT ${SELECT_COLUMNS} FROM registration_entries WHERE registration_id = $1 LIMIT 1`,
      [registrationId],
    );
    return result.rows.length ? mapRow(result.rows[0]) : null;
  }

  async listByUser(userId: string): Promise<RegistrationEntry[]> {
    const result = await this.pool.query(
      `SELECT ${SELECT_COLUMNS} FROM registration_entries WHERE user_id = $1 ORDER BY applied_at DESC`,
      [userId],
    );
    return result.rows.map(mapRow);
  }

  async listByTournament(tournamentId: string): Promise<RegistrationEntry[]> {
    const result = await this.pool.query(
      `SELECT ${SELECT_COLUMNS} FROM registration_entries WHERE tournament_id = $1 ORDER BY applied_at ASC`,
      [tournamentId],
    );
    return result.rows.map(mapRow);
  }

  async updateStatus(args: RegistrationStatusUpdate): Promise<RegistrationEntry | null> {
    const result = await this.pool.query(
      `UPDATE registration_entries
          SET status = $2,
              status_reason = $3,
              decided_by_user_id = $4,
              status_at = NOW(),
              updated_at = NOW()
        WHERE registration_id = $1
        RETURNING ${SELECT_COLUMNS}`,
      [args.registrationId, args.status, args.statusReason ?? null, args.decidedByUserId ?? null],
    );
    return result.rows.length ? mapRow(result.rows[0]) : null;
  }
}

function mapRow(row: any): RegistrationEntry {
  return {
    registrationId: row.registration_id,
    tournamentId: row.tournament_id,
    userId: row.user_id,
    personId: row.person_id,
    eventIds: row.event_ids ?? [],
    partnerUserId: row.partner_user_id,
    answers: row.answers ?? {},
    status: row.status,
    statusReason: row.status_reason,
    appliedAt: toIso(row.applied_at),
    statusAt: toIso(row.status_at),
    decidedByUserId: row.decided_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}
