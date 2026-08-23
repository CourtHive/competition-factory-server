import type { GrantScope } from 'src/modules/factory/helpers/grantScope';

export const GRANT_STORAGE = Symbol('GRANT_STORAGE');

/**
 * Scoped, time-bounded capability grants.
 *
 * Distinct from IAssignmentStorage, which carries the coarse per-tournament
 * visibility row and cannot express scope: its PK is (tournament_id, user_id),
 * so a user holds exactly one assignment per tournament.
 */
export interface IGrantStorage {
  /** Grants held by a subject on a tournament. The authorization hot path. */
  findForSubject(userId: string, tournamentId: string): Promise<TournamentGrantRow[]>;

  /** All grants on a tournament — the manage-access UI. */
  findByTournamentId(tournamentId: string): Promise<TournamentGrantRow[]>;

  create(row: Omit<TournamentGrantRow, 'grantId' | 'grantedAt'>): Promise<{ grantId: string }>;

  revoke(grantId: string): Promise<{ success: boolean }>;

  /** Revoke every grant a subject holds on a tournament. */
  revokeForSubject(userId: string, tournamentId: string): Promise<{ revoked: number }>;
}

export interface TournamentGrantRow {
  grantId: string;
  tournamentId: string;
  userId: string;
  providerId: string;
  /** A capability name, not a role — roles are presets that expand to these. */
  capability: string;
  /** Empty object means tournament-wide, which is the pre-existing behavior. */
  scope: GrantScope;
  notBefore?: string | null;
  notAfter?: string | null;
  grantedBy?: string | null;
  grantedAt?: string;
}
