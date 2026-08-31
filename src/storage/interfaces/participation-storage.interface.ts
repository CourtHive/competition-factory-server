export const PARTICIPATION_STORAGE = Symbol('PARTICIPATION_STORAGE');

/** The grain a participation row is keyed at. TEAM is served today; PERSON reuses these rows. */
export type ParticipationSubjectType = 'TEAM' | 'PERSON';

export interface ParticipationRow {
  subjectType: ParticipationSubjectType;
  subjectId: string;
  tournamentId: string;
  participantId: string;
  providerId?: string;
  tournamentName?: string;
  startDate?: string;
  endDate?: string;
  eventCount?: number;
}

export interface IParticipationStorage {
  /**
   * Replace every row for one tournament, in one transaction.
   *
   * Replace rather than upsert: a participant REMOVED from a tournament must lose its row, and an
   * upsert-only maintenance path leaves that row behind forever. Scoped to the one tournamentId, so
   * it stays O(participants-in-one-tournament) however large the table grows.
   */
  replaceTournamentRows(tournamentId: string, rows: ParticipationRow[]): Promise<{ success: boolean }>;

  /** Every tournament one subject took part in, earliest first. O(rows-for-this-subject). */
  listForSubject(
    subjectType: ParticipationSubjectType,
    subjectId: string,
  ): Promise<ParticipationRow[]>;

  /** Drop a tournament's rows when the tournament itself is deleted. */
  deleteTournamentRows(tournamentId: string): Promise<{ success: boolean }>;
}
