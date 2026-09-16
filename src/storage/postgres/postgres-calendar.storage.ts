import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { CALENDAR_TOURNAMENT_COLUMNS, fromRow } from './calendarTournamentRow';
import type { CalendarQuery, ICalendarStorage } from '../interfaces/calendar-storage.interface';
import { SUCCESS } from 'src/common/constants/app';
import { PG_POOL } from './postgres.config';

const COLUMNS = CALENDAR_TOURNAMENT_COLUMNS.join(', ');

/**
 * `calendar_tournaments` — one row per tournament (migration 047).
 *
 * Replaces a per-provider JSONB array that was read whole to serve any page and rewritten
 * whole on every save. Scoping, publish filtering and the page window all run in SQL here,
 * so `scopeCalendarForUser` is no longer on the calendar read path.
 */
@Injectable()
export class PostgresCalendarStorage implements ICalendarStorage {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Upsert one tournament's row.
   *
   * A provider MOVE is this same statement with a different `provider_id`: `tournament_id`
   * is the primary key, so the row relocates in place. That is the whole of what
   * `detachFromOtherCalendars` used to do by reading every provider's calendar into memory.
   */
  async upsertTournament(row: any): Promise<{ success: boolean }> {
    const values = CALENDAR_TOURNAMENT_COLUMNS.map((column) => {
      const value = row[column];
      // pg serialises objects/arrays for json/jsonb params, but an ARRAY parameter is
      // ambiguous — it would be sent as a Postgres array literal rather than JSON. Stringify
      // arrays explicitly; leave objects and scalars to the driver.
      return Array.isArray(value) ? JSON.stringify(value) : value;
    });
    const placeholders = CALENDAR_TOURNAMENT_COLUMNS.map((_column, index) => `$${index + 1}`).join(', ');
    const updates = CALENDAR_TOURNAMENT_COLUMNS.filter((column) => column !== 'tournament_id')
      .map((column) => `${column} = EXCLUDED.${column}`)
      .join(', ');

    await this.pool.query(
      `INSERT INTO calendar_tournaments (${COLUMNS})
       VALUES (${placeholders})
       ON CONFLICT (tournament_id) DO UPDATE SET ${updates}, row_updated_at = NOW()`,
      values,
    );
    return { ...SUCCESS };
  }

  async removeTournament(tournamentId: string): Promise<{ success: boolean }> {
    await this.pool.query('DELETE FROM calendar_tournaments WHERE tournament_id = $1', [tournamentId]);
    return { ...SUCCESS };
  }

  async getTournament(tournamentId: string): Promise<any | null> {
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM calendar_tournaments WHERE tournament_id = $1`,
      [tournamentId],
    );
    return result.rows.length ? fromRow(result.rows[0] as any) : null;
  }

  async queryTournaments(
    query: CalendarQuery,
  ): Promise<{ rows: any[]; total: number; totalsByProvider: Record<string, number> }> {
    // No target providers means NO calendars — never "all". The 2026-09-15 incident was an
    // empty scope read as unrestricted, so the empty case fails closed here too.
    if (!query.providerIds.length) return { rows: [], total: 0, totalsByProvider: {} };

    const { where, params } = this.buildWhere(query);

    // Grouped rather than a bare COUNT(*): the response carries a per-calendar `total`, and
    // one grouped scan yields both that and the grand total.
    const countResult = await this.pool.query(
      `SELECT provider_id, COUNT(*)::int AS total FROM calendar_tournaments WHERE ${where} GROUP BY provider_id`,
      params,
    );
    const totalsByProvider: Record<string, number> = {};
    let total = 0;
    for (const row of countResult.rows) {
      totalsByProvider[row.provider_id] = row.total;
      total += row.total;
    }

    // `tournament_id` is the tiebreaker, and it is not decoration: start_date is not unique
    // (and is nullable), so without a unique final sort key LIMIT/OFFSET paging can repeat
    // a row on one page and skip it on the next.
    const rowsResult = await this.pool.query(
      `SELECT ${COLUMNS} FROM calendar_tournaments
       WHERE ${where}
       ORDER BY start_date DESC NULLS LAST, tournament_id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, query.offset],
    );

    return { rows: rowsResult.rows.map((row) => fromRow(row as any)), total, totalsByProvider };
  }

  async listProviderTournaments(providerId: string): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM calendar_tournaments WHERE provider_id = $1 ORDER BY start_date DESC NULLS LAST, tournament_id`,
      [providerId],
    );
    return result.rows.map((row) => fromRow(row as any));
  }

  /**
   * The WHERE clause and its parameters, mirroring `scopeCalendarForUser` in SQL.
   *
   * Kept as one builder so the COUNT and the page cannot drift onto different predicates —
   * which would make `hasMore` lie.
   */
  private buildWhere(query: CalendarQuery): { where: string; params: any[] } {
    const { scope } = query;
    const clauses = ['provider_id = ANY($1)'];
    const params: any[] = [query.providerIds];

    if (!scope.unrestricted) {
      const visibility: string[] = [];

      if (scope.fullAccessProviderIds.length) {
        params.push(scope.fullAccessProviderIds);
        visibility.push(`provider_id = ANY($${params.length})`);
      }

      if (scope.directorProviderIds.length) {
        params.push(scope.directorProviderIds);
        const directorProviders = `provider_id = ANY($${params.length})`;

        const ownership: string[] = [];
        if (scope.userId) {
          params.push(scope.userId);
          ownership.push(`created_by_user_id = $${params.length}`);
        }
        if (scope.assignedTournamentIds.length) {
          params.push(scope.assignedTournamentIds);
          ownership.push(`tournament_id = ANY($${params.length})`);
        }

        // A director with neither a userId nor assignments can see nothing at those
        // providers — `FALSE` rather than an omitted clause, which would widen the read to
        // every tournament there.
        visibility.push(`(${directorProviders} AND (${ownership.length ? ownership.join(' OR ') : 'FALSE'}))`);
      }

      // No visibility rung at all: the caller has no role anywhere in the targets.
      clauses.push(visibility.length ? `(${visibility.join(' OR ')})` : 'FALSE');
    }

    if (query.publishedOnly) clauses.push('published');

    return { where: clauses.join(' AND '), params };
  }
}
