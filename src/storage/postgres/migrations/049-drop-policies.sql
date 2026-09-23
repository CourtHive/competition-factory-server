-- 049-drop-policies.sql
-- AFFECTS: admin
-- Drops the `policies` table. Policy hosting moved to AMS (its migration 0096), where
-- sanctioning lives and where attachment happens when a record is approved.
--
-- ── WHY IT IS SAFE, MEASURED RATHER THAN ASSUMED ─────────────────────────────
--
-- Queried on prod 2026-09-23, before writing this:
--
--   SELECT count(*) FROM policies;                    -- 13
--   SELECT published_by, count(*) ... GROUP BY 1;      -- seed-loader | 13
--   SELECT count(*) WHERE deleted_at IS NOT NULL;      -- 0
--
-- Every row is a boot-time seed, 1:1 with `seeds/policies/` (12 `_global` ranking-point
-- policies plus `typti-1.0.json` for provider 1d18e15a-6bd7-4766-ac65-0fcab034dcf4).
-- Nothing was ever authored through the API: `published_by` would carry a userId. So the
-- files were the source of truth and this table was their cache — AMS re-seeds from the
-- same files and rebuilds it there.
--
-- CFS itself never read it. `PoliciesService` was referenced nowhere outside its own
-- module, and the only endpoint with a caller on disk was `GET /policies/catalog`
-- (TMX's catalog page), which now points at AMS. TMX's own "My Policies" is local Dexie.
--
-- ── ORDERING, WHICH MATTERS ──────────────────────────────────────────────────
--
-- This migration must not run before the CFS release that removes the module. The old
-- code seeds this table at boot and serves `/policies/catalog` from it, so dropping it
-- under a running old instance fails the seed loader and 500s the catalog. Deploy the
-- code, then run migrations — the normal order here, stated because the consequence of
-- inverting it is a boot failure rather than a quiet one.
--
-- The rows are recoverable without a backup: re-running the AMS seed loader rebuilds
-- them from the committed seed files, which is the same operation that created them.
--
-- ── WHY THIS ASSERTS ITS OWN PREMISE ─────────────────────────────────────────
--
-- The measurements above are from nest's prod DB and Button's (13 and 12 rows, every
-- one `seed-loader`, none soft-deleted). That is exactly the reasoning that made
-- `048-drop-legacy-calendars.sql` destroy 5,844 rows on Button: it argued from the
-- state of the host its author had looked at, and ran somewhere else.
--
-- So this does not trust the census. It re-derives the premise on whatever host it
-- runs against, and REFUSES rather than dropping if the premise does not hold there.
-- `published_by` is the discriminator: the seed loader writes 'seed-loader', while
-- anything authored through the API carries a userId. A host with authored policies
-- gets a loud failure naming the count, not a silent loss.

DO $$
DECLARE
  authored bigint;
BEGIN
  IF to_regclass('public.policies') IS NULL THEN
    RAISE NOTICE '049: policies table absent — nothing to drop';
    RETURN;
  END IF;

  SELECT count(*) INTO authored
    FROM policies
   WHERE published_by IS DISTINCT FROM 'seed-loader';

  IF authored > 0 THEN
    RAISE EXCEPTION
      '049 refuses to drop policies: % row(s) were not written by seed-loader. This migration''s '
      'premise — that every row is a boot-time seed rebuildable from seeds/policies/ — does not '
      'hold on this host. Export those rows into AMS before re-running.', authored;
  END IF;

  DROP TABLE policies;
  RAISE NOTICE '049: dropped policies (all rows were seed-loader)';
END $$;
