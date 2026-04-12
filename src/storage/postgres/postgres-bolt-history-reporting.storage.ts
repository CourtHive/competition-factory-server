import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';

import {
  IBoltHistoryReporting,
  PlayerPointStats,
  TournamentLeader,
} from '../interfaces/bolt-history-reporting.interface';
import { PG_POOL } from './postgres.config';

/**
 * Postgres reporting adapter using JSONB array operators against
 * `bolt_history.data->'engineState'->'history'->'points'`.
 *
 * Each query unrolls the points array with `jsonb_array_elements` and
 * filters / aggregates with stock SQL. The schema is the same one
 * created by PostgresBoltHistoryStorage.ensureSchema().
 */
@Injectable()
export class PostgresBoltHistoryReportingStorage implements IBoltHistoryReporting {
  private readonly logger = new Logger(PostgresBoltHistoryReportingStorage.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getPlayerPointStats({
    participantId,
    tournamentId,
  }: {
    participantId: string;
    tournamentId?: string;
  }): Promise<{ stats?: PlayerPointStats; error?: string }> {
    if (!participantId) return { error: 'participantId required' };
    if (!this.pool) return { error: 'PostgresBoltHistoryReportingStorage requires a Pool' };

    try {
      const params: unknown[] = [participantId];
      let where = "data->'sides' @> $2::jsonb";
      params.push(JSON.stringify([{ participant: { participantId } }]));

      if (tournamentId) {
        where += ' AND tournament_id = $3';
        params.push(tournamentId);
      }

      const matchUpsResult = await this.pool.query(
        `SELECT COUNT(*) AS count FROM bolt_history WHERE ${where}`,
        params.slice(1),
      );
      const matchUpsParticipated = Number(matchUpsResult.rows[0]?.count ?? 0);

      const pointsParams: unknown[] = [participantId];
      let pointsWhere = '1=1';
      if (tournamentId) {
        pointsWhere += ' AND tournament_id = $2';
        pointsParams.push(tournamentId);
      }

      const pointsResult = await this.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE point->>'winnerParticipantId' = $1) AS points_won,
           COUNT(*) AS points_played
         FROM bolt_history,
              jsonb_array_elements(COALESCE(data->'engineState'->'history'->'points', '[]'::jsonb)) AS point
         WHERE ${pointsWhere}`,
        pointsParams,
      );

      const pointsWon = Number(pointsResult.rows[0]?.points_won ?? 0);
      const pointsPlayed = Number(pointsResult.rows[0]?.points_played ?? 0);

      return {
        stats: {
          participantId,
          pointsWon,
          pointsPlayed,
          winRate: pointsPlayed === 0 ? 0 : pointsWon / pointsPlayed,
          matchUpsParticipated,
        },
      };
    } catch (err: any) {
      this.logger.error(`getPlayerPointStats failed: ${err?.message ?? err}`);
      return { error: err?.message ?? 'unknown error' };
    }
  }

  async getTournamentLeaders({
    tournamentId,
    limit,
  }: {
    tournamentId: string;
    limit?: number;
  }): Promise<{ leaders?: TournamentLeader[]; error?: string }> {
    if (!tournamentId) return { error: 'tournamentId required' };
    if (!this.pool) return { error: 'PostgresBoltHistoryReportingStorage requires a Pool' };

    const cap = Math.max(1, Math.min(100, limit ?? 10));

    try {
      const result = await this.pool.query(
        `WITH participants AS (
           SELECT
             tie_matchup_id,
             side->'participant'->>'participantId' AS participant_id,
             side->'participant'->>'participantName' AS participant_name
           FROM bolt_history,
                jsonb_array_elements(COALESCE(data->'sides', '[]'::jsonb)) AS side
           WHERE tournament_id = $1
             AND side->'participant'->>'participantId' IS NOT NULL
         ),
         points_won_per_participant AS (
           SELECT
             point->>'winnerParticipantId' AS participant_id,
             COUNT(*) AS points_won
           FROM bolt_history,
                jsonb_array_elements(COALESCE(data->'engineState'->'history'->'points', '[]'::jsonb)) AS point
           WHERE tournament_id = $1
             AND point->>'winnerParticipantId' IS NOT NULL
           GROUP BY point->>'winnerParticipantId'
         ),
         participant_match_counts AS (
           SELECT
             participant_id,
             MAX(participant_name) AS participant_name,
             COUNT(DISTINCT tie_matchup_id) AS matchups
           FROM participants
           GROUP BY participant_id
         )
         SELECT
           pmc.participant_id,
           pmc.participant_name,
           COALESCE(pwp.points_won, 0) AS points_won,
           pmc.matchups
         FROM participant_match_counts pmc
         LEFT JOIN points_won_per_participant pwp ON pwp.participant_id = pmc.participant_id
         ORDER BY points_won DESC
         LIMIT $2`,
        [tournamentId, cap],
      );

      const leaders: TournamentLeader[] = result.rows.map((row) => ({
        participantId: row.participant_id,
        participantName: row.participant_name ?? undefined,
        pointsWon: Number(row.points_won ?? 0),
        matchUpsParticipated: Number(row.matchups ?? 0),
      }));

      return { leaders };
    } catch (err: any) {
      this.logger.error(`getTournamentLeaders failed: ${err?.message ?? err}`);
      return { error: err?.message ?? 'unknown error' };
    }
  }
}
