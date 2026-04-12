-- 003-add-bolt-history.sql
-- Adds the bolt_history table for per-tieMatchUp INTENNSE scoring documents.
--
-- This DDL is also executed idempotently at runtime by
-- PostgresBoltHistoryStorage.ensureSchema(), so a fresh Mac mini deployment
-- does not require this file to be applied manually. It is provided here for
-- operators who prefer explicit schema management.
--
-- Apply with:
--   psql -d courthive -f 003-add-bolt-history.sql

CREATE TABLE IF NOT EXISTS bolt_history (
  tie_matchup_id    TEXT PRIMARY KEY,
  parent_matchup_id TEXT NOT NULL,
  tournament_id     TEXT NOT NULL,
  event_id          TEXT,
  draw_id           TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  data              JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bolt_history_tournament ON bolt_history (tournament_id);
CREATE INDEX IF NOT EXISTS idx_bolt_history_updated_at ON bolt_history (updated_at DESC);
