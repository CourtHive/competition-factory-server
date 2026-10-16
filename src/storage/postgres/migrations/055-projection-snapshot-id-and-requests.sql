-- 055-projection-snapshot-id-and-requests.sql
-- AFFECTS: admin
-- Two additions for the read-model projection (Mentat/planning/CFS_LARGE_SAVES.md §10). Both are additive, and no
-- reader or writer depends on them until the code that uses them ships.
--
-- 1. projection_queue.snapshot_id: every BODY row of a snapshot span carries the span's snapshotId, so the consumer
--    can select a span's rows by id rather than by the seq range between its markers. A seq range is only sound while
--    nothing for the same tournament lands inside it. NULL for incremental deltas and for every row written before
--    this migration; the consumer falls back to the seq range when a span's rows carry none.
--
-- 2. projection_snapshot_requests: a wholesale save records that its tournament needs a snapshot, inside the
--    tournament lock, instead of building the span on the request path. A separate producer builds the span from the
--    stored record and inserts it only after a fence finds the record unchanged. The primary key coalesces repeat
--    saves of one tournament into one pending request.
--
-- 054 is reserved for command_receipts (the durable-outbox work, being renumbered from 052).

ALTER TABLE projection_queue ADD COLUMN IF NOT EXISTS snapshot_id TEXT;
CREATE INDEX IF NOT EXISTS idx_projection_queue_snapshot_id
  ON projection_queue (snapshot_id) WHERE snapshot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS projection_snapshot_requests (
  tournament_id TEXT PRIMARY KEY,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source        TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT
);
