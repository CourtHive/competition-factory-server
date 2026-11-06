-- 061-tournament-storage-layout.sql
-- AFFECTS: end-users
--
-- The seam for an OPTIONAL second storage layout (record sharding: planning/CFS_RECORD_SHARDING_EXPLORATION.md in
-- Mentat). Nothing here changes what any read returns: every tournament is in the `document` layout, which is today's
-- one-row-per-tournament `tournaments.data`, and stays fully supported whether or not sharding is ever enabled.
--
-- tournament_storage_layout: one row per tournament NOT in the document layout. No row means `document`, so this table
-- is empty unless sharding is switched on for a tournament, and `tournaments` is not altered (an ALTER would need an
-- AccessExclusiveLock on the hottest table at boot; see 059).
--
-- tournament_document() and tournament_shell(): the ONE place SQL decides how a record (or its shell, for the light
-- projections) is assembled. Every read of a whole record selects through tournament_document(), including the raw
-- readers outside the tournament storage (projection, provider archive). Today both return `data` unchanged and the
-- planner inlines them; a sharded layout replaces their bodies, not their callers.
CREATE TABLE IF NOT EXISTS tournament_storage_layout (
  tournament_id TEXT PRIMARY KEY,
  layout        TEXT NOT NULL CHECK (layout IN ('document', 'sharded')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION tournament_document(p_tournament_id TEXT, p_data JSONB)
RETURNS JSONB LANGUAGE sql STABLE AS $$ SELECT p_data $$;

CREATE OR REPLACE FUNCTION tournament_shell(p_tournament_id TEXT, p_data JSONB)
RETURNS JSONB LANGUAGE sql STABLE AS $$ SELECT p_data $$;
