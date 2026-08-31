import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import {
  IParticipationStorage,
  ParticipationRow,
  ParticipationSubjectType,
} from '../interfaces/participation-storage.interface';
import { PG_POOL } from './postgres.config';
import { SUCCESS } from 'src/common/constants/app';

function toRow(row: any): ParticipationRow {
  return {
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    tournamentId: row.tournament_id,
    participantId: row.participant_id,
    organisationId: row.organisation_id ?? undefined,
    providerId: row.provider_id ?? undefined,
    tournamentName: row.tournament_name ?? undefined,
    // pg returns DATE as a Date; the rest of the system speaks ISO day strings.
    startDate: row.start_date ? toISODay(row.start_date) : undefined,
    endDate: row.end_date ? toISODay(row.end_date) : undefined,
    eventCount: row.event_count ?? undefined,
  };
}

/**
 * A DATE column carries no time and no zone, so it must not be rendered through anything
 * zone-aware: `toISOString()` on a Date built at local midnight moves the day backwards west of
 * UTC. Read the calendar fields the driver already resolved.
 */
function toISODay(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

@Injectable()
export class PostgresParticipationStorage implements IParticipationStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async replaceTournamentRows(tournamentId: string, rows: ParticipationRow[]): Promise<{ success: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Delete-then-insert inside one transaction: a reader never sees a tournament's
      // participation half-rewritten, and a participant removed upstream loses its row.
      await client.query('DELETE FROM participation_index WHERE tournament_id = $1', [tournamentId]);
      for (const row of rows) {
        await client.query(
          `INSERT INTO participation_index
             (subject_type, subject_id, tournament_id, participant_id, organisation_id, provider_id,
              tournament_name, start_date, end_date, event_count, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
           ON CONFLICT (subject_type, subject_id, tournament_id, participant_id) DO UPDATE SET
             organisation_id = EXCLUDED.organisation_id,
             provider_id = EXCLUDED.provider_id,
             tournament_name = EXCLUDED.tournament_name,
             start_date = EXCLUDED.start_date,
             end_date = EXCLUDED.end_date,
             event_count = EXCLUDED.event_count,
             updated_at = NOW()`,
          [
            row.subjectType,
            row.subjectId,
            tournamentId,
            row.participantId,
            row.organisationId ?? null,
            row.providerId ?? null,
            row.tournamentName ?? null,
            row.startDate ?? null,
            row.endDate ?? null,
            row.eventCount ?? null,
          ],
        );
      }
      await client.query('COMMIT');
      return { ...SUCCESS };
    } catch (error) {
      // The ROLLBACK is itself guarded.
      //
      // A checked-out client whose backend dies stops being queryable, so `ROLLBACK` REJECTS, and
      // unguarded that rejection propagates INSTEAD of `error`.
      //
      // Measured, because the obvious framing overstates it. When the connection dies FIRST, the
      // statement failed because of it and `error` already says
      // `Client has encountered a connection error and is not queryable` — replacing it with an
      // identical message costs nothing. The damaging case needs a RACE: an informative failure
      // (a constraint violation, say) and then the connection dying before the rollback runs. Then
      // `duplicate key value violates unique constraint` is replaced by the generic connection
      // message and the incident loses its root cause.
      //
      // Narrow, therefore — but the cost when it lands is an undiagnosable failure, and the fix is
      // this `try`. There is nothing to roll back either way: the transaction died with the
      // connection.
      try {
        await client.query('ROLLBACK');
      } catch {
        // Already gone. Keep the original error, which is the one that explains anything.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listForSubject(
    subjectType: ParticipationSubjectType,
    subjectId: string,
    organisationId?: string,
  ): Promise<ParticipationRow[]> {
    // The issuer filter is applied in SQL rather than after the fact: filtering in JS would still
    // read every body's rows for the id, which is the cost this narrowing exists to avoid.
    const result = await this.pool.query(
      `SELECT subject_type, subject_id, tournament_id, participant_id, organisation_id, provider_id,
              tournament_name, start_date, end_date, event_count
         FROM participation_index
        WHERE subject_type = $1 AND subject_id = $2
          AND ($3::text IS NULL OR organisation_id = $3)
        ORDER BY start_date NULLS LAST, tournament_id`,
      [subjectType, subjectId, organisationId ?? null],
    );
    return result.rows.map(toRow);
  }

  async deleteTournamentRows(tournamentId: string): Promise<{ success: boolean }> {
    await this.pool.query('DELETE FROM participation_index WHERE tournament_id = $1', [tournamentId]);
    return { ...SUCCESS };
  }
}
