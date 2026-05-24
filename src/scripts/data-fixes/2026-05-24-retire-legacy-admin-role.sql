-- 2026-05-24-retire-legacy-admin-role.sql
--
-- Retires the deprecated global `admin` role from users.roles. Root cause of
-- the "clubx@ionsport.com routed to /admin" report: the global `admin` role
-- (which 34 of 43 accounts carry as legacy cruft) is what surfaced admin UI in
-- TMX and made the account admin-routable, independent of the modern
-- provider-scoped role model (user_providers.provider_role). The correct admin
-- signal is PROVIDER_ADMIN at a provider (via user_providers) or a
-- provisioner-managed provider — neither of which needs the global role.
--
-- Also repoints clubx@ionsport.com's stale legacy home + last-selected provider
-- from ION (9fd68963…, a provider the account is NOT associated with) to BOBOCA
-- (24bf9f25…, where it is PROVIDER_ADMIN). jason1@clubx.com stays a BOBOCA
-- DIRECTOR — only its global `admin` role is stripped (by statement 1).
--
-- !!! ORDERING CONSTRAINT !!!
-- Deploy the provider-scoped admin gate FIRST (TMX `isActiveProviderAdmin` +
-- admin-client `canAccessAdmin`, branch fix/provisioner-admin-routing). Until
-- that ships, TMX grants admin UI ONLY via the global `admin` role, so running
-- this beforehand would strip every PROVIDER_ADMIN's admin UI. Server authz is
-- unaffected (it resolves provider roles from user_providers, not the JWT role).
--
-- Scope note: this does NOT drop users.provider_id or remove the back-compat
-- shim in buildUserContext (that is TASKS.md "Phase 5 — Retire users.provider_id").
-- After this runs the shim is simply a no-op for these accounts.
--
-- Idempotent and transaction-wrapped. Safe to re-run.
--
-- Usage on courthive-mentat (writes against the nest prod DB):
--
--   PGPASSWORD=courthive_dev psql -h 10.128.0.4 -U tennis_aip -d courthive \
--     -f src/scripts/data-fixes/2026-05-24-retire-legacy-admin-role.sql

\set ON_ERROR_STOP on
BEGIN;

-- ============================================================================
-- 0) Before-state report
-- ============================================================================
\echo '--- accounts carrying the legacy global admin role (before) ---'
SELECT count(*) AS legacy_admin_users FROM users WHERE roles @> '["admin"]'::jsonb;

\echo '--- clubX / jason1 (before) ---'
SELECT email, roles, provider_id, last_selected_provider_id
FROM users
WHERE email IN ('clubx@ionsport.com', 'jason1@clubx.com')
ORDER BY email;

-- ============================================================================
-- 1) Strip the legacy global "admin" element from users.roles everywhere.
--    Rebuilds the jsonb array preserving the original order of the survivors.
--    Idempotent: after this no row matches the WHERE, so a re-run is a no-op.
-- ============================================================================
UPDATE users
SET roles = (
  SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(roles) WITH ORDINALITY AS arr(elem, ord)
  WHERE elem <> '"admin"'::jsonb
)
WHERE roles @> '["admin"]'::jsonb;

-- ============================================================================
-- 2) Repoint clubx@ionsport.com's stale ION pointers to BOBOCA (its only
--    user_providers association, role PROVIDER_ADMIN). Guarded so a re-run is
--    a no-op.
-- ============================================================================
UPDATE users
SET provider_id = '24bf9f25-96ca-401e-9660-f5571ebc50ba',
    last_selected_provider_id = '24bf9f25-96ca-401e-9660-f5571ebc50ba'
WHERE email = 'clubx@ionsport.com'
  AND (
    provider_id IS DISTINCT FROM '24bf9f25-96ca-401e-9660-f5571ebc50ba'
    OR last_selected_provider_id IS DISTINCT FROM '24bf9f25-96ca-401e-9660-f5571ebc50ba'
  );

-- ============================================================================
-- 3) After-state report
-- ============================================================================
\echo '--- accounts carrying the legacy global admin role (after; expect 0) ---'
SELECT count(*) AS legacy_admin_users FROM users WHERE roles @> '["admin"]'::jsonb;

\echo '--- clubX / jason1 (after) ---'
SELECT email, roles, provider_id, last_selected_provider_id
FROM users
WHERE email IN ('clubx@ionsport.com', 'jason1@clubx.com')
ORDER BY email;

COMMIT;
