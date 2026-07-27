-- 040-drop-bolt-history.sql
-- Remove the INTENNSE-era `bolt_history` table. Point-by-point history is no
-- longer a CFS responsibility — it moved to the score-relay + courthive-query
-- (`match_up_point_history`). CFS stays CODES-only. See
-- Mentat/planning/MATCHUP_HISTORY_PERSISTENCE.md (D5/D7).
--
-- Durable: the only runtime re-creator of this table was
-- postgres-bolt-history.storage.ts ensureSchema() (CREATE TABLE IF NOT EXISTS),
-- deleted in the same change. Migration 003 is already-applied and never re-runs.
-- Prod `bolt_history` was empty (0 rows) at removal time. Indexes drop with the table.

DROP TABLE IF EXISTS bolt_history CASCADE;
