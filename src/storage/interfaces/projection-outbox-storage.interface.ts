export const PROJECTION_OUTBOX_STORAGE = Symbol('PROJECTION_OUTBOX_STORAGE');

/**
 * One projected read-model delta destined for the `projection_queue` outbox.
 * CFS is the single writer; the courthive-query consumer drains rows in `seq`
 * order and applies them idempotently to the read tables.
 *
 * - `op` — 'upsert' writes `row` into `table`; 'delete' removes rows matching
 *          `key`; 'update' sets `row`'s columns on rows matching `key`
 *          (`UPDATE … SET <row> WHERE <key>`) — used for targeted column writes
 *          where the full PK isn't known (e.g. a person-claim stamping
 *          `person_id` on every competitor/entry row for a participantId).
 * - `table` — target read table (snake_case, e.g. 'match_ups').
 * - `key`  — identifies the target row(s). For upsert it is the row's primary
 *            key; for delete/update it is an arbitrary equality filter the
 *            consumer turns into `WHERE <key>` (so a whole draw/event can be
 *            removed by `{ draw_id }` / `{ event_id }`).
 * - `row`  — the projected row for an upsert, or the SET columns for an update
 *            (snake_case columns matching the query-service schema); omitted for deletes.
 * - `topic`— originating factory notice topic, for provenance/debugging.
 *
 * SNAPSHOT OPS (`snapshot_begin` / `snapshot_end`) bracket a WHOLESALE replace —
 * a tournamentRecord pushed in its entirety (`/factory/save`, provider-key save,
 * backend pipeline load) rather than mutated through
 * `executionQueue`. Such a push raises no factory notices, so there is no diff to
 * express incrementally, and upserts alone are not sufficient: an entity REMOVED
 * from the record emits nothing, so its read-model rows would survive forever.
 *
 * The consumer must treat `snapshot_begin` … `snapshot_end` as ONE transaction:
 *
 *   1. on `snapshot_begin`, open a transaction and
 *      `DELETE FROM <t> WHERE tournament_id = $tournamentId`
 *      for every table in `row.tables`;
 *   2. apply the upserts that follow;
 *   3. on `snapshot_end` (matching `key.snapshotId`), COMMIT.
 *
 * Applying it atomically is what keeps readers from ever observing a
 * half-emptied tournament. Both markers carry `key.snapshotId`; `snapshot_end`
 * also carries `row.deltaCount` so a consumer can detect a truncated span rather
 * than committing a partial snapshot.
 */
export interface ProjectionDelta {
  tournamentId: string;
  op: 'upsert' | 'delete' | 'update' | 'snapshot_begin' | 'snapshot_end';
  table: string;
  key: Record<string, any>;
  row?: Record<string, any>;
  topic?: string;
  /**
   * The span this row belongs to, on every BODY row of a snapshot span (migration 055). The consumer selects a span's
   * rows by it rather than by the seq range between the markers. Absent on incremental deltas.
   */
  snapshotId?: string;
}

/** A stored record as the projection reads it, with its row version as Postgres holds it (microseconds intact). */
export interface ProjectionSource {
  tournamentRecord: any;
  /** `tournaments.updated_at::text`. Compared IN SQL by the fence; a JS Date would drop the microseconds. */
  updatedAt: string;
}

export type FencedEnqueueResult = 'enqueued' | 'changed' | 'missing';

/** A tournament waiting for its snapshot to be built off the request path (migration 055). */
export interface SnapshotRequest {
  tournamentId: string;
  /** `requested_at::text`: a request re-made while its span was being built must survive that build. */
  requestedAt: string;
  source?: string;
  attempts: number;
}

export interface IProjectionOutboxStorage {
  /** True only when a pg pool exists AND PROJECTION_OUTBOX_ENABLED=true. */
  readonly isEnabled: boolean;
  /**
   * Append deltas to `projection_queue` in ONE transaction, chunked so no statement exceeds Postgres's bind-parameter
   * limit. Uses `client` (and its open transaction) when given. No-op on [].
   */
  enqueue(deltas: ProjectionDelta[], options?: { client?: any }): Promise<void>;
  /** Read a record and its row version for projecting outside the tournament lock. Undefined when absent. */
  readForProjection(tournamentId: string): Promise<ProjectionSource | undefined>;
  /**
   * Enqueue deltas built from a record read outside the lock, only if that record is still the stored one. In one
   * transaction: `SELECT … FOR SHARE` the tournaments row, compare `updated_at` with `updatedAt` in SQL, insert the
   * deltas. A save landing after the fence blocks on the share lock and enqueues after these rows; a save that landed
   * between the read and the fence changes `updated_at`, and nothing is written ('changed': rebuild and retry).
   */
  enqueueIfUnchanged(params: {
    tournamentId: string;
    updatedAt: string;
    deltas: ProjectionDelta[];
  }): Promise<FencedEnqueueResult>;
  /**
   * Record, inside the save's tournament lock, that these tournaments need a snapshot; the producer builds it. One
   * pending request per tournament: a repeat save refreshes `requested_at` and resets the attempt count.
   */
  requestSnapshots(tournamentIds: string[], source: string, options?: { client?: any }): Promise<void>;
  /** The oldest pending requests, at most `limit`. */
  pendingSnapshotRequests(limit: number): Promise<SnapshotRequest[]>;
  /**
   * The producer's commit, in ONE transaction: the `enqueueIfUnchanged` fence, the span, and the deletion of the
   * request it served. The request is deleted only if it is still the one read: a save that re-requested the
   * snapshot meanwhile leaves it pending. 'missing' (the tournament is gone) deletes the request.
   */
  completeSnapshot(params: {
    tournamentId: string;
    requestedAt: string;
    updatedAt: string;
    deltas: ProjectionDelta[];
  }): Promise<FencedEnqueueResult>;
  /** Count a failed build against its request, keeping the error for /health/projection and an operator. */
  recordSnapshotFailure(tournamentId: string, error: string): Promise<void>;
}
