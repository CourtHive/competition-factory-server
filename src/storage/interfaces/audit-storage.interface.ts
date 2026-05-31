export const AUDIT_STORAGE = Symbol('AUDIT_STORAGE');

/**
 * Polymorphic actor — who initiated this audit event.
 *
 * Replaces the legacy UUID-typed `userId` field which broke for
 * provisioner / provider / service callers whose identifiers aren't
 * UUIDs (e.g. `provisioner:<uuid>`). The `kind` discriminates the
 * identifier space:
 *
 *   'user'        regular human user; `id` is users.user_id (uuid)
 *   'provisioner' provisioner API key; `id` is provisioners.provisioner_id (uuid)
 *   'provider'    provider API key;    `id` is providers.provider_id (uuid)
 *   'service'     internal service;    `id` is a free-form short name
 *                                       (e.g. 'score-relay', 'audit-worker')
 *
 * Existing rows pre-migration-036 carry only `userId`. Post-036 rows
 * carry an `actor` and leave `userId` undefined.
 */
export interface AuditActor {
  kind: 'user' | 'provisioner' | 'provider' | 'service';
  id: string;
}

/**
 * Audit row — one per executionQueue payload or system event (e.g. tournament deletion).
 *
 * Deliberately has NO foreign key to the tournaments table so audit rows
 * survive tournament deletion. The `tournamentId` is a denormalized value.
 */
export interface AuditRow {
  auditId: string;
  tournamentId: string;
  /** @deprecated use `actor` — kept for back-compat with pre-036 rows. */
  userId?: string;
  userEmail?: string;
  actor?: AuditActor;
  source?: string;
  occurredAt: string;
  actionType: 'MUTATION' | 'DELETE_TOURNAMENT' | 'DELETE_DRAW' | 'SAVE' | string;
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

  /** Look up a single audit row by id. Returns null when not found. */
  findById(auditId: string): Promise<AuditRow | null>;

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
