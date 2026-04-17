export const TOURNAMENT_PROVISIONER_STORAGE = Symbol('TOURNAMENT_PROVISIONER_STORAGE');

/**
 * Storage interface for tournament→provisioner ownership mapping.
 * Tracks which provisioner created each tournament, used for subsidiary
 * access enforcement (subsidiaries can only modify their own tournaments).
 */
export interface ITournamentProvisionerStorage {
  /** Get the provisioner that created a tournament. */
  getByTournament(tournamentId: string): Promise<TournamentProvisionerRow | null>;

  /** Get all tournaments created by a provisioner, optionally scoped to a provider. */
  getByProvisioner(provisionerId: string, providerId?: string): Promise<TournamentProvisionerRow[]>;

  /** Record that a provisioner created a tournament. */
  create(row: Omit<TournamentProvisionerRow, 'createdAt'>): Promise<{ success: boolean }>;

  /** Remove a tournament's provisioner mapping (e.g. on tournament deletion). */
  remove(tournamentId: string): Promise<{ success: boolean }>;
}

export interface TournamentProvisionerRow {
  tournamentId: string;
  provisionerId: string;
  providerId: string;
  createdAt?: string;
}
