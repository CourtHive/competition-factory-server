import { commandClient } from './commandTransaction';
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { SUCCESS } from 'src/common/constants/app';
import { PG_POOL } from './postgres.config';
import {
  IParticipationStorage,
  ParticipationRow,
  ParticipationSubjectType,
} from '../interfaces/participation-storage.interface';

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

const rowKey = (row: ParticipationRow) => [row.subjectType, row.subjectId, row.participantId].join('|');

/**
 * One row per primary key, the last one winning — what the per-row upsert this replaced did with a repeated key. A
 * single multi-row INSERT cannot repeat a key at all.
 */
function uniqueByKey(rows: ParticipationRow[]): ParticipationRow[] {
  return [...new Map(rows.map((row) => [rowKey(row), row])).values()];
}

/** Order-independent: the same rows in any order are the same index. */
function fingerprintRows(rows: ParticipationRow[]): string {
  const canonical = rows
    .map((row) =>
      JSON.stringify([
        row.subjectType,
        row.subjectId,
        row.participantId,
        row.organisationId ?? null,
        row.providerId ?? null,
        row.tournamentName ?? null,
        row.startDate ?? null,
        row.endDate ?? null,
        row.eventCount ?? null,
      ]),
    )
    .sort();
  return createHash('sha256').update(canonical.join('\n')).digest('hex');
}

@Injectable()
export class PostgresParticipationStorage implements IParticipationStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Replace a tournament's rows — or do nothing, when they are the rows already written.
   *
   * Called on EVERY save, score entries included. It used to delete the tournament's rows and re-insert them one
   * INSERT round trip per participant, whether or not anything had changed: a score entry in a 600-participant
   * tournament made about 600 round trips. Now a fingerprint of the rows (migration 060) decides first, in the same
   * transaction as the rows, so the two cannot disagree: unchanged rows cost one round trip, and changed rows are
   * written in a single INSERT.
   */
  async replaceTournamentRows(
    tournamentId: string,
    rows: ParticipationRow[],
  ): Promise<{ success: boolean; unchanged?: boolean }> {
    const unique = uniqueByKey(rows);
    const fingerprint = fingerprintRows(unique);
    const borrowed = commandClient(this.pool);
    const client = borrowed ?? (await this.pool.connect());
    try {
      await client.query(borrowed ? 'SAVEPOINT participation_write' : 'BEGIN');
      // Claims the new fingerprint only when it differs from the stored one: no row back = nothing changed.
      const claimed = await client.query(
        `INSERT INTO participation_index_state (tournament_id, fingerprint) VALUES ($1, $2)
         ON CONFLICT (tournament_id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, updated_at = NOW()
           WHERE participation_index_state.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint
         RETURNING tournament_id`,
        [tournamentId, fingerprint],
      );
      if (!claimed.rowCount) {
        await client.query(borrowed ? 'RELEASE SAVEPOINT participation_write' : 'COMMIT');
        return { ...SUCCESS, unchanged: true };
      }
      // Delete-then-insert inside one transaction: a reader never sees a tournament's
      // participation half-rewritten, and a participant removed upstream loses its row.
      await client.query('DELETE FROM participation_index WHERE tournament_id = $1', [tournamentId]);
      if (unique.length) {
        await client.query(
          `INSERT INTO participation_index
             (subject_type, subject_id, tournament_id, participant_id, organisation_id, provider_id,
              tournament_name, start_date, end_date, event_count, updated_at)
           SELECT subject_type, subject_id, $1, participant_id, organisation_id, provider_id,
                  tournament_name, start_date, end_date, event_count, NOW()
             FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::date[],
                         $9::date[], $10::int[])
               AS r(subject_type, subject_id, participant_id, organisation_id, provider_id, tournament_name,
                    start_date, end_date, event_count)`,
          [
            tournamentId,
            unique.map((row) => row.subjectType),
            unique.map((row) => row.subjectId),
            unique.map((row) => row.participantId),
            unique.map((row) => row.organisationId ?? null),
            unique.map((row) => row.providerId ?? null),
            unique.map((row) => row.tournamentName ?? null),
            unique.map((row) => row.startDate ?? null),
            unique.map((row) => row.endDate ?? null),
            unique.map((row) => row.eventCount ?? null),
          ],
        );
      }
      await client.query(borrowed ? 'RELEASE SAVEPOINT participation_write' : 'COMMIT');
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
        await client.query(borrowed ? 'ROLLBACK TO SAVEPOINT participation_write' : 'ROLLBACK');
      } catch {
        // Already gone. Keep the original error, which is the one that explains anything.
      }
      throw error;
    } finally {
      if (!borrowed) client.release();
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
    // The fingerprint goes with the rows: kept, a tournament re-created under the same id with the same participants
    // would match it and never write its rows.
    await this.pool.query(
      `WITH gone AS (DELETE FROM participation_index_state WHERE tournament_id = $1)
       DELETE FROM participation_index WHERE tournament_id = $1`,
      [tournamentId],
    );
    return { ...SUCCESS };
  }
}
