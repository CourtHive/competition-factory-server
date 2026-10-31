-- 057-projection-document-requests.sql
-- AFFECTS: admin
-- Public participant documents (Mentat/planning/PUBLIC_VIEWS_PRIVACY_PLACEMENT.md, W3). A save that changes a
-- tournament's participants, or the privacy policy attached to it, records here, inside the tournament lock, that the
-- tournament's documents need rebuilding. Projection-Producer builds them from the stored record off the lock and
-- inserts them as one span only after the fence finds the record unchanged, exactly as for snapshot requests (055).
-- The primary key coalesces a burst of participant edits into one pending rebuild.
--
-- Additive: nothing reads or writes this table until the code that uses it ships.

CREATE TABLE IF NOT EXISTS projection_document_requests (
  tournament_id TEXT PRIMARY KEY,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source        TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT
);
