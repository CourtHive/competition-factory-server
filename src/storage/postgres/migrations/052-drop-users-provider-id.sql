-- 052-drop-users-provider-id.sql
-- AFFECTS: end-users
-- (users is on the login path, so the deploy gate stops for typed confirmation.)
-- Drops users.provider_id, the pre-association "home" provider column, and its index.
--
-- A user's providers are user_providers rows. Multi-provider Phase 4 retired the column in two steps
-- (Mentat/planning/MULTI_PROVIDER_CONTEXT_COMPLETION.md):
--   1. the buildUserContext shim that derived provider roles from it, with 051 backfilling its grants as rows
--      (competition-factory-server#1015, courthive-hiveid#61);
--   2. every read and write of it (competition-factory-server#1016, courthive-hiveid#62, courthive-ams#230).
--
-- PRECONDITION: step 2 is DEPLOYED to prod in CFS, courthive-hiveid AND courthive-ams. Dev and prod share
-- this database, and the runner applies pending migrations at boot, so this runs on the first deploy of a
-- build that carries it, in either environment. Code from before step 2 selects the column; it fails against
-- a database without it, and so does a rollback to such a build.
--
-- Swept 2026-10-07: on prod, idx_users_provider is the only object depending on the column (no constraint,
-- view, trigger or function); in code, only historical migrations (006, 025, 051) and one-off data-fix
-- scripts name it. Idempotent.

DROP INDEX IF EXISTS idx_users_provider;
ALTER TABLE users DROP COLUMN IF EXISTS provider_id;
