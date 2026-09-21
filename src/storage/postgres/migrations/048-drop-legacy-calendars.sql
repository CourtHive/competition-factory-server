-- 048-drop-legacy-calendars.sql
-- AFFECTS: admin
-- Drops the legacy `calendars` table. No end-user read or write path touches it.
--
-- This is the migration 047 named and deferred: "Dropping it is 048, and only after prod
-- has run on the new path, so this migration stays reversible by pointing the storage layer
-- back." Prod has run on `calendar_tournaments` since release 2026-09-17-0026-46959c5 —
-- four days at time of writing, across the IONSport calendar incident and its fixes.
--
-- ── WHY NOW, AND WHY IT IS NOT MERELY TIDYING ────────────────────────────────
--
-- Leaving it was not free. Measured on prod 2026-09-19, BOBOCA's legacy row held 30 entries
-- against 33 real tournaments: the table had been silently diverging since the cutover,
-- because 047 moved every writer and left two readers behind.
--
-- Both are in the provider DECOMMISSION path, which is where a stale copy does real damage:
--
--   ProviderArchiveService  archived `calendars` as calendar.json and never captured
--                           `calendar_tournaments`;
--   revive-provider.mjs     restored calendar.json into `calendars` — a table nothing reads.
--
-- So a decommission → revive round trip returned a provider with NO calendar, silently, and
-- the archive that was supposed to make the delete recoverable preserved a stale projection
-- instead of the live one. `ProviderCleanupService` was the only one of the three that had
-- been taught about both tables, so the wipe was correct and the record of it was not.
--
-- Those are fixed in the same change as this migration. Dropping the table is what stops the
-- pair from drifting apart again — a second stored representation of one fact is the P19
-- class, and the cure is subtraction.
--
-- ── WHAT WAS CHECKED BEFORE DROPPING ─────────────────────────────────────────
--
--   * every `FROM calendars` / `INTO calendars` / `UPDATE calendars` in the repo, outside
--     migrations: archive, revive, cleanup, the test teardown and cleanup-test-data — all
--     repointed at `calendar_tournaments` in this change;
--   * `PostgresCalendarStorage` reads and writes `calendar_tournaments` exclusively;
--   * `2026-09-13-boboca-to-jtcc.sql` names `calendars` and is deliberately NOT updated: it
--     is an applied historical record of what was run that day, not live code.
--
-- The prod table (1,120 rows) was dumped to
-- `preserved/2026-09-21-prod-legacy-calendars-table-dump.sql` before this migration was
-- written. A DROP is not reversible by re-running a migration, so the dump is the way back.
--
-- ── IF THIS EVER NEEDS UNDOING ───────────────────────────────────────────────
--
-- Restoring the table from that dump gives back the rows, but NOT their currency — they were
-- already four days stale when dumped and grow staler. Anything that genuinely needs the
-- legacy shape should rebuild it from `calendar_tournaments`, which is authoritative.
--
-- ── THE GUARD BELOW EXISTS BECAUSE THIS MIGRATION DESTROYED DATA ─────────────
--
-- Everything above argues from a premise about NEST: "prod has run on the new path since
-- 2026-09-17, so `calendars` is a stale second copy." That premise was true there and was
-- never CHECKED here — and 047 creates `calendar_tournaments` WITHOUT backfilling it (nest's
-- rows came from a separate backfill step run before the 047 release).
--
-- So on any host where 047 and 048 apply in the SAME boot, this dropped the only populated
-- copy moments after 047 created an empty replacement. That happened on Button (the always-on
-- ingest host, own local Postgres) on 2026-09-21: 5,844 calendar entries destroyed, recovered
-- by recomputing them from the tournament records through the same `getCalendarEntry` +
-- `toRow` the save path uses. Recoverable only because the calendar is a PROJECTION; had it
-- been authoritative the dump in `preserved/` would have been the only way back, and that
-- dump is of nest's rows, not Button's.
--
-- A migration that is safe only because of a fact about one database must assert that fact.
-- This one now refuses unless the new table is populated or the old one is empty — so it is a
-- no-op on a fresh database (both empty) and on an already-migrated one, and it halts loudly
-- on a host that has not backfilled yet.

DO $$
DECLARE
  legacy_rows INT;
  new_rows    INT;
BEGIN
  IF to_regclass('calendars') IS NULL THEN
    RETURN; -- already dropped; nothing to check or do
  END IF;

  EXECUTE 'SELECT count(*) FROM calendars' INTO legacy_rows;
  EXECUTE 'SELECT count(*) FROM calendar_tournaments' INTO new_rows;

  IF legacy_rows > 0 AND new_rows = 0 THEN
    RAISE EXCEPTION
      'REFUSING to drop `calendars`: it holds % row(s) and `calendar_tournaments` is EMPTY. '
      'Migration 047 does not backfill — populate the new table first (re-save the records, or '
      'recompute each entry with getCalendarEntry + toRow), then re-run. Dropping here would '
      'destroy the only populated copy, as it did on Button 2026-09-21.',
      legacy_rows;
  END IF;
END $$;

DROP TABLE IF EXISTS calendars;
