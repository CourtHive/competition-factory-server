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
 */
export interface ProjectionDelta {
  tournamentId: string;
  op: 'upsert' | 'delete' | 'update';
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
