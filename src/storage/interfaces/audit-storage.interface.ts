export const AUDIT_STORAGE = Symbol('AUDIT_STORAGE');

/**
 * Audit row — one per executionQueue payload or system event (e.g. tournament deletion).
 *
 * Deliberately has NO foreign key to the tournaments table so audit rows
 * survive tournament deletion. The `tournamentId` is a denormalized value.
 */
export interface AuditRow {
  auditId: string;
  tournamentId: string;
  userId?: string;
  userEmail?: string;
  source?: string;
  occurredAt: string;
  actionType: 'MUTATION' | 'DELETE_TOURNAMENT' | 'SAVE' | string;
  methods: Array<{ method: string; params?: any }>;
  status: 'applied' | 'rejected' | 'partial' | string;
  metadata?: Record<string, any>;
  errorCode?: string;
}

/**
 * Storage interface for the append-only audit log.
 * Queries are always scoped by tournamentId + time range.
 */
export interface IAuditStorage {
  /** Append one audit row. Fail-soft callers should catch errors. */
  append(row: AuditRow): Promise<void>;

  /** Query audit rows for a tournament, newest first. */
  findByTournamentId(
    tournamentId: string,
    options?: { from?: string; to?: string; limit?: number },
  ): Promise<AuditRow[]>;

  /** Query audit rows by action type (e.g. 'DELETE_TOURNAMENT'), newest first. */
  findByActionType(
    actionType: string,
    options?: { from?: string; to?: string; limit?: number },
  ): Promise<AuditRow[]>;

  /** Delete audit rows older than the given date. Returns count of deleted rows. */
  prune(olderThan: Date): Promise<number>;
}
