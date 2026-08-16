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
 * commit-save, backend pipeline load) rather than mutated through
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
}

export interface IProjectionOutboxStorage {
  /** True only when a pg pool exists AND PROJECTION_OUTBOX_ENABLED=true. */
  readonly isEnabled: boolean;
  /** Bulk-append deltas to `projection_queue` in a single INSERT. No-op on []. */
  enqueue(deltas: ProjectionDelta[]): Promise<void>;
}
