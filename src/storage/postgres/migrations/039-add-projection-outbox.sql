-- 039-add-projection-outbox.sql
-- Read-model projection outbox. CFS is the SINGLE WRITER: the flag-gated
-- delta producers (getMutationEngine subscriptions + the executionQueue
-- post-commit flush + the explicit deleteSingleTournament hook) append
-- per-row deltas here after a mutation commits. The courthive-query
-- consumer reads rows in `seq` order, applies them idempotently to the
-- read tables, and advances its OWN cursor (owned by the query service,
-- never written by CFS — S6 single-writer-per-table).
--
-- Each row is one delta: op ∈ {upsert, delete}, table_name is the target
-- read table, row_key identifies the row (JSONB so composite keys are
-- natural), row_data is the full projected row for upserts (NULL for
-- deletes), topic records the originating factory notice for provenance.

CREATE TABLE IF NOT EXISTS projection_queue (
  seq           BIGSERIAL PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  op            TEXT NOT NULL,        -- upsert | delete
  table_name    TEXT NOT NULL,        -- tournaments | match_ups | match_up_competitors | entries | tournament_venues | venues
  row_key       JSONB NOT NULL,       -- composite key identifying the target row
  row_data      JSONB,                -- full projected row (upsert); NULL for delete
  topic         TEXT,                 -- originating factory notice topic (provenance)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Consumer reads in seq order; this is the PK so no extra index needed for
-- ordered draining. Index the tournament for reconciliation / targeted purge.
CREATE INDEX IF NOT EXISTS idx_projection_queue_tournament ON projection_queue(tournament_id);
