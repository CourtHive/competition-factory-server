-- AFFECTS: admin
-- 041-drop-officiating-sanctioning.sql
-- Remove the `official_records` + `sanctioning_records` tables created by
-- migration 013 when LevelDB was retired. Officiating and sanctioning are
-- courthive-ams's domain, not CFS's: the owning CFS modules were un-registered
-- 2026-05-27 and deleted 2026-06-26 (AMS-WS-07 / AMS-WS-08), and the live data
-- lives in `courthive_ams` as `ams.official_record` (+ six sibling officiating
-- tables) and `ams.sanctioning_record`. CFS reaches sanctioning through
-- SanctioningClient over the service token, never through these tables.
--
-- Durable: nothing re-creates them. Migration 013 is already-applied and never
-- re-runs, and no ensureSchema()-style runtime creator exists — the only
-- remaining readers were provider archive/cleanup/revive raw SQL, removed in
-- the same change. Indexes drop with the tables.
--
-- Data: prod `courthive` held 0 rows in both tables at removal time, and all
-- eight provider archives on nest carry empty (`[]`) payloads for both, so the
-- "data migration into courthive_ams" tail in AMS_DEPLOY_AND_RETIREMENT.md
-- §CFS retirement windows has nothing to move.

DROP TABLE IF EXISTS official_records CASCADE;
DROP TABLE IF EXISTS sanctioning_records CASCADE;
