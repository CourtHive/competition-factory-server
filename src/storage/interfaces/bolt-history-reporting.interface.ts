export const BOLT_HISTORY_REPORTING = Symbol('BOLT_HISTORY_REPORTING');

export interface PlayerPointStats {
  participantId: string;
  pointsWon: number;
  pointsPlayed: number;
  winRate: number; // 0..1
  matchUpsParticipated: number;
}

export interface TournamentLeader {
  participantId: string;
  participantName?: string;
  pointsWon: number;
  matchUpsParticipated: number;
}

export interface IBoltHistoryReporting {
  /**
   * Aggregate per-player points across one or all tournaments.
   * If `tournamentId` is omitted, aggregates across every stored bolt history.
   */
  getPlayerPointStats(params: {
    participantId: string;
    tournamentId?: string;
  }): Promise<{ stats?: PlayerPointStats; error?: string }>;

  /**
   * Top scorers across a single tournament. Limit defaults to 10.
   */
  getTournamentLeaders(params: {
    tournamentId: string;
    limit?: number;
  }): Promise<{ leaders?: TournamentLeader[]; error?: string }>;
}
