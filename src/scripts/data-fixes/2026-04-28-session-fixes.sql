-- 2026-04-28-session-fixes.sql
--
-- Bundled prod data fixes from the 2026-04-28 session. Idempotent and
-- transaction-wrapped — safe to run multiple times. Designed to be
-- applied immediately on prod (courthive-mentat) without waiting for a
-- redeploy. The migrations referenced below are also committed in
-- src/storage/postgres/migrations/, so the migration runner will skip
-- them next deploy because we mark them applied at the bottom.
--
-- Usage on courthive-mentat (same Postgres as the deployed server):
--
--   psql -d courthive -f src/scripts/data-fixes/2026-04-28-session-fixes.sql
--
-- Or with explicit connection params from your env:
--
--   psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" \
--        -f src/scripts/data-fixes/2026-04-28-session-fixes.sql
--
-- The transaction reports counts at every step and rolls back on any
-- error. The final SELECTs let you eyeball the result without having
-- to re-query.

\set ON_ERROR_STOP on
BEGIN;

-- ============================================================================
-- 1) Strip stale `lastAccess` from providers.data JSONB (= migration 018)
-- ============================================================================
-- The lastAccess feature originally wrote into the LevelDB record body.
-- The Postgres migration carried that field into the `data` JSONB blob.
-- A read-path field-ordering bug then let the stale JSONB value shadow
-- the canonical `last_access` column on every read, so the admin Providers
-- panel showed weeks-old timestamps despite the column updating correctly.
-- The read path is now defensive (column wins on spread); this strips the
-- redundant field so any consumer reading raw JSONB no longer sees it.

UPDATE providers
   SET data = data - 'lastAccess'
 WHERE data ? 'lastAccess';

\echo '== providers cleaned =='
SELECT COUNT(*) AS providers_with_stale_data_lastaccess_remaining
  FROM providers
 WHERE data ? 'lastAccess';

-- ============================================================================
-- 2) Strip stale `lastAccess` from users.data JSONB (= migration 019)
-- ============================================================================
-- Identical bug for the users table. Same fix.

UPDATE users
   SET data = data - 'lastAccess'
 WHERE data ? 'lastAccess';

\echo '== users cleaned =='
SELECT COUNT(*) AS users_with_stale_data_lastaccess_remaining
  FROM users
 WHERE data ? 'lastAccess';

-- ============================================================================
-- 3) Promote tmx@courthive.com to PROVIDER_ADMIN at TMX Sandbox
-- ============================================================================
-- The user_providers row was backfilled as DIRECTOR before the legacy
-- 'admin' role was added to users.roles, and the role-edit UI never syncs
-- to user_providers. The strengthened back-compat shim in
-- buildUserContext now promotes legacy 'admin' → PROVIDER_ADMIN at every
-- request, so this UPDATE is no longer strictly required once the new
-- server build is deployed — but it's still the right thing to do so the
-- DB matches reality.

UPDATE user_providers
   SET provider_role = 'PROVIDER_ADMIN', updated_at = NOW()
 WHERE user_id = (SELECT user_id FROM users WHERE email = 'tmx@courthive.com')
   AND provider_id = 'fce22f65-08d5-4df5-998f-cbead6e823a4'
   AND provider_role <> 'PROVIDER_ADMIN';

\echo '== tmx@courthive.com role =='
SELECT u.email, up.provider_id, up.provider_role, up.updated_at
  FROM users u
  JOIN user_providers up ON up.user_id = u.user_id
 WHERE u.email = 'tmx@courthive.com';

-- ============================================================================
-- 4) Record migrations 018 + 019 as applied so the runner skips them
-- ============================================================================
-- The runner uses a `schema_migrations(name TEXT PK)` tracking table.
-- Without these inserts, the next deploy would re-run them — that's
-- harmless (idempotent), but inserting the markers keeps the migration
-- log clean and matches what the runner would have written itself.
-- ON CONFLICT DO NOTHING handles the case where someone already applied
-- the migrations through the runner.

INSERT INTO schema_migrations (name, applied_at) VALUES
  ('018-drop-stale-data-lastaccess.sql',      NOW()),
  ('019-drop-stale-user-data-lastaccess.sql', NOW())
ON CONFLICT (name) DO NOTHING;

\echo '== migrations marked applied =='
SELECT name, applied_at
  FROM schema_migrations
 WHERE name IN ('018-drop-stale-data-lastaccess.sql', '019-drop-stale-user-data-lastaccess.sql')
 ORDER BY name;

COMMIT;
\echo '== all done =='
