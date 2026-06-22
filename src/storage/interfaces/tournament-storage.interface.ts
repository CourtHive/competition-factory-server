export const TOURNAMENT_STORAGE = Symbol('TOURNAMENT_STORAGE');

export interface ITournamentStorage {
  findTournamentRecord(params: {
    tournamentId: string;
  }): Promise<{ tournamentRecord?: any; error?: string }>;

  fetchTournamentRecords(params: {
    tournamentIds?: string[];
    tournamentId?: string;
  }): Promise<{ success?: boolean; tournamentRecords?: Record<string, any>; fetched?: number; notFound?: number; error?: any }>;

  /**
   * Lightweight staleness probe — returns only a tournament's `updatedAt`
   * (plus the minimal fields the access gates need) without loading the full
   * record. `providerId` and `extensions` are projected from the JSONB for
   * authorization and are not surfaced to clients.
   */
  fetchTournamentUpdatedAt(params: {
    tournamentId?: string;
  }): Promise<{
    success?: boolean;
    tournamentId?: string;
    updatedAt?: string;
    providerId?: string;
    extensions?: any[];
    error?: any;
  }>;

  saveTournamentRecord(params: { tournamentRecord: any }): Promise<{ success?: boolean; error?: string }>;

  saveTournamentRecords(params: {
    tournamentRecords?: Record<string, any>;
    tournamentRecord?: any;
  }): Promise<{ success?: boolean; error?: string }>;

  removeTournamentRecords(params: {
    tournamentIds?: string[];
    tournamentId?: string;
  }): Promise<{ success?: boolean; removed?: number; error?: string }>;

  /**
   * Archive a full tournament record before deletion so the delete is
   * recoverable. Must succeed before `removeTournamentRecords` runs — callers
   * treat a failed archive as a hard stop on the delete.
   */
  archiveTournamentRecord(params: {
    tournamentRecord: any;
    deletedByUserId?: string;
    deletedByEmail?: string;
  }): Promise<{ success?: boolean; error?: string }>;

  listTournamentIds(): Promise<string[]>;
}
