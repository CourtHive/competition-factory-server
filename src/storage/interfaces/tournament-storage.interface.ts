export const TOURNAMENT_STORAGE = Symbol('TOURNAMENT_STORAGE');

/**
 * How a tournament's record is stored. `document` is the one-row-per-tournament `tournaments.data` and is the default
 * and always-supported layout; `sharded` (shell, draws and participants in rows of their own) is optional and
 * per tournament. A tournament with no layout row is in `document`.
 */
export type StorageLayout = 'document' | 'sharded';

export interface ITournamentStorage {
  findTournamentRecord(params: { tournamentId: string }): Promise<{ tournamentRecord?: any; error?: string }>;

  /**
   * Every call returns objects that no other caller holds: never a cached or shared instance.
   * `executionQueue` mutates them in place, without a copy, on that guarantee.
   */
  fetchTournamentRecords(params: { tournamentIds?: string[]; tournamentId?: string }): Promise<{
    success?: boolean;
    tournamentRecords?: Record<string, any>;
    /** Per tournament, when its row was last written (`tournaments.updated_at`). See P49. */
    serverUpdatedAt?: Record<string, string>;
    fetched?: number;
    notFound?: number;
    error?: any;
  }>;

  /**
   * Lightweight staleness probe — returns only a tournament's `updatedAt`
   * (plus the minimal fields the access gates need) without loading the full
   * record. `providerId` and `extensions` are projected from the JSONB for
   * authorization and are not surfaced to clients.
   */
  fetchTournamentUpdatedAt(params: { tournamentId?: string }): Promise<{
    success?: boolean;
    tournamentId?: string;
    /** The record's own `data.updatedAt` — almost always absent. Kept for clients that still read it. */
    updatedAt?: string;
    /** When the row was last written (`tournaments.updated_at`): what staleness should compare. */
    serverUpdatedAt?: string;
    providerId?: string;
    extensions?: any[];
    error?: any;
  }>;

  /**
   * `ownerEpoch` is the fencing token this writer was granted for the
   * tournament (migration 042). Defaults to 0 in the implementation — never
   * treated as "unguarded" when absent. A save rejected by the fence resolves
   * with `{ error: FENCED_BY_NEWER_OWNER, fenced: true }`.
   */
  saveTournamentRecord(params: {
    tournamentRecord: any;
    ownerEpoch?: number;
  }): Promise<{ success?: boolean; error?: string; fenced?: boolean; serverUpdatedAt?: string }>;

  saveTournamentRecords(params: {
    tournamentRecords?: Record<string, any>;
    tournamentRecord?: any;
    ownerEpoch?: number;
  }): Promise<{ success?: boolean; error?: string; fenced?: boolean; serverUpdatedAt?: Record<string, string> }>;

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

  /** The layout of each requested tournament; every id is present in the result, `document` when it has no row. */
  fetchStorageLayouts(params: { tournamentIds: string[] }): Promise<Record<string, StorageLayout>>;
}
