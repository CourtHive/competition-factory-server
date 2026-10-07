-- 051-backfill-legacy-provider-roles.sql
-- AFFECTS: admin
-- Writes, as real user_providers rows, exactly the provider roles the buildUserContext back-compat shim
-- grants at request time, so the shim can be removed without changing anyone's access.
--
-- THE SHIM, which this replaces (CFS and courthive-hiveid buildUserContext, removed in the same change):
--   1. a user with the deprecated global `admin` role is PROVIDER_ADMIN at their users.provider_id home,
--      overriding whatever user_providers says there;
--   2. a user with a home and NO user_providers rows at all is DIRECTOR there.
-- Applied below in that order, so an `admin` with a home and no rows gets PROVIDER_ADMIN, as the shim gives.
--
-- MEASURED ON PROD, 2026-10-07, before writing this: of the 12 `admin`-role users, 7 already hold
-- PROVIDER_ADMIN at their home (rule 1 writes nothing for them) and 5 have no home (the shim never applied);
-- 1 other user has a home and no rows, but that home is no longer a provider, so the JOIN skips it. A dry run
-- on prod wrote 0 rows: the shim was granting nobody anything the rows did not. The migration exists for the
-- other databases (dev, Button). Idempotent: re-running writes nothing.
-- See Mentat/planning/MULTI_PROVIDER_CONTEXT_COMPLETION.md, Phase 4.

-- 1. legacy `admin` role → PROVIDER_ADMIN at the home provider
INSERT INTO user_providers (user_id, provider_id, provider_role)
SELECT u.user_id, u.provider_id, 'PROVIDER_ADMIN'
  FROM users u
  JOIN providers p ON p.provider_id = u.provider_id
 WHERE u.provider_id IS NOT NULL
   AND u.provider_id <> ''
   AND u.roles @> '["admin"]'::jsonb
ON CONFLICT (user_id, provider_id) DO UPDATE
   SET provider_role = 'PROVIDER_ADMIN', updated_at = NOW()
 WHERE user_providers.provider_role IS DISTINCT FROM 'PROVIDER_ADMIN';

-- 2. a home and no association rows at all → DIRECTOR at the home provider
INSERT INTO user_providers (user_id, provider_id, provider_role)
SELECT u.user_id, u.provider_id, 'DIRECTOR'
  FROM users u
  JOIN providers p ON p.provider_id = u.provider_id
 WHERE u.provider_id IS NOT NULL
   AND u.provider_id <> ''
   AND NOT EXISTS (SELECT 1 FROM user_providers up WHERE up.user_id = u.user_id)
ON CONFLICT (user_id, provider_id) DO NOTHING;
