export const ASSIGNMENT_STORAGE = Symbol('ASSIGNMENT_STORAGE');

/**
 * Storage interface for tournament↔user access grants.
 * A PROVIDER_ADMIN or SUPER_ADMIN grants a user access to a specific
 * tournament. The grant is only valid if the user has a user_providers
 * row for the tournament's provider.
 */
export interface IAssignmentStorage {
  /** Get all assignments for a tournament. */
  findByTournamentId(tournamentId: string): Promise<TournamentAssignmentRow[]>;

  /** Get all assignments for a user (optionally scoped to a provider). */
  findByUserId(userId: string, providerId?: string): Promise<TournamentAssignmentRow[]>;

  /** Check if a specific assignment exists. */
  findOne(tournamentId: string, userId: string): Promise<TournamentAssignmentRow | null>;

  /** Create an assignment. Fails silently if it already exists (ON CONFLICT DO NOTHING). */
  grant(row: TournamentAssignmentRow): Promise<{ success: boolean }>;

  /** Remove an assignment. */
  revoke(tournamentId: string, userId: string): Promise<{ success: boolean }>;
}

export interface TournamentAssignmentRow {
  tournamentId: string;
  userId: string;
  providerId: string;
  assignmentRole: 'DIRECTOR' | 'ASSISTANT' | 'SCORER' | 'OBSERVER' | string;
  grantedBy: string;
  grantedAt?: string;
  /** Convenience: populated by some queries that join with users table. */
  email?: string;
}
