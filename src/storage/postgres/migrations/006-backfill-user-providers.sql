-- 006-backfill-user-providers.sql
-- One-time backfill: copies existing users.provider_id into user_providers.
-- Users with 'admin' in their roles array get PROVIDER_ADMIN; everyone else
-- with a provider_id gets DIRECTOR.
--
-- After this migration, users.provider_id is deprecated but NOT dropped
-- (kept for one release for rollback safety; dropped in a later Phase 0.5 migration).

INSERT INTO user_providers (user_id, provider_id, provider_role)
SELECT
  u.user_id,
  u.provider_id,
  CASE
    WHEN u.roles @> '"admin"'::jsonb THEN 'PROVIDER_ADMIN'
    ELSE 'DIRECTOR'
  END
FROM users u
WHERE u.provider_id IS NOT NULL
  AND u.provider_id != ''
ON CONFLICT (user_id, provider_id) DO NOTHING;
