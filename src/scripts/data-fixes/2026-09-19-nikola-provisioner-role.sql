-- 2026-09-19-nikola-provisioner-role.sql
--
-- Grant the `provisioner` GLOBAL ROLE to nikola@ionsport.com
-- (0fcb97be-5915-4fab-addd-bd2faa9e468d).
--
-- WHY
-- nikola is an IONSport provisioner admin — they have a `user_provisioners` row for
-- IONSport (78da61fe-…) — but their `users.roles` JSONB lacks `provisioner`. Two places
-- gate on that role rather than on the table:
--
--   * buildUserContext (auth/helpers) populates `provisionerProviderIds` ONLY when
--     `globalRoles.includes(PROVISIONER)`. Without it the context carries an empty set, so
--     every authz rung that honours provisioner-inherited access (checkTournamentAccess,
--     checkProvider, buildCalendarScope) sees no providers.
--   * auth.service.ts:308 embeds `provisionerIds` + `provisionerProviders` in the login
--     payload only for PROVISIONER-role users. That array is what TMX's provider switcher
--     renders (`initProviderSwitcher.ts:46`).
--
-- Net effect today: nikola has NO user_providers row and no legacy provider_id either, so
-- `getMyCalendars` → resolveTargetProviderIds resolves ZERO target providers and the
-- tournaments list is empty. Measured in prod nginx: `/provider/my-calendars` returned
-- exactly 104 bytes (the empty-calendars body) three times at 18:30-18:31 on 2026-09-18.
--
-- This grant makes TMX offer the provider switcher over the four IONSport-owned providers
-- (BOBOCA, ION, JTCC, KRONOS), and picking one sends `providerAbbr` — which
-- resolveTargetProviderIds accepts from any authenticated caller, with
-- buildCalendarScope's provisioner rung granting full access. So it unblocks on the
-- CURRENTLY DEPLOYED release with no code change.
--
-- WHY NOT user_providers ROWS
-- Minting PROVIDER_ADMIN rows at four providers would duplicate privilege the provisioner
-- relationship already confers, and become drift nobody removes once the selector fix
-- lands. The role is the accurate fact.
--
-- NO NEW PRIVILEGE: the role only unlocks access to providers IONSport already owns via
-- provisioner_providers. admin@ioncourt.com — the other IONSport provisioner admin — has
-- carried this exact role since 2026-05.
--
-- Idempotent: re-running is a no-op (the guard aborts if the role is already present).
-- Requires a fresh LOGIN to take effect — the role is read at token mint
-- (auth.service.ts:308), and per `project_auth_stateless_no_session_revocation` existing
-- tokens are not revocable. nikola must log out and back in.
--
-- Usage on courthive-mentat (writes against the nest prod DB):
--
--   PGPASSWORD=… psql -h "$PG_HOST" -U "$PG_USER" -d "$PG_DATABASE" \
--     -f src/scripts/data-fixes/2026-09-19-nikola-provisioner-role.sql

\set ON_ERROR_STOP on
\pset pager off

\set uid '''0fcb97be-5915-4fab-addd-bd2faa9e468d'''

BEGIN;

-- ============================================================================
-- 0) Guard — refuse unless the premise holds
-- ============================================================================
-- The user must exist, must NOT already carry the role, and must actually administer a
-- provisioner. The last is the whole justification: this grant asserts a fact recorded in
-- user_provisioners, it does not invent one.

DO $$
DECLARE
  has_role      BOOLEAN;
  provisioners  INT;
BEGIN
  SELECT (roles ? 'provisioner') INTO has_role
    FROM users WHERE user_id = '0fcb97be-5915-4fab-addd-bd2faa9e468d';

  IF has_role IS NULL THEN
    RAISE EXCEPTION 'User 0fcb97be-… (nikola@ionsport.com) not found';
  END IF;

  IF has_role THEN
    RAISE EXCEPTION 'Already has the provisioner role — nothing to do (re-run of a completed grant)';
  END IF;

  SELECT COUNT(*) INTO provisioners
    FROM user_provisioners WHERE user_id = '0fcb97be-5915-4fab-addd-bd2faa9e468d';

  IF provisioners = 0 THEN
    RAISE EXCEPTION 'Refusing: no user_provisioners row — the role would grant access this user has no basis for';
  END IF;
END $$;

\echo == BEFORE ==
SELECT email, roles, (roles ? 'provisioner') AS has_provisioner_role
  FROM users WHERE user_id = :uid;

\echo == providers this role will expose (IONSport-owned) ==
SELECT p.organisation_abbreviation AS abbr, p.organisation_name, pp.relationship
  FROM user_provisioners up
  JOIN provisioner_providers pp ON pp.provisioner_id = up.provisioner_id
  JOIN providers p ON p.provider_id = pp.provider_id
 WHERE up.user_id = :uid
 ORDER BY p.organisation_abbreviation;

-- ============================================================================
-- 1) Append the role
-- ============================================================================
-- `||` on a jsonb array appends. The guard above established the role is absent, so this
-- cannot duplicate it.

UPDATE users
   SET roles = roles || '["provisioner"]'::jsonb
 WHERE user_id = :uid;

\echo == AFTER ==
SELECT email, roles, (roles ? 'provisioner') AS has_provisioner_role
  FROM users WHERE user_id = :uid;

-- Invariant: exactly one occurrence of the role, and nothing else changed about the array.
DO $$
DECLARE
  occurrences INT;
BEGIN
  SELECT COUNT(*) INTO occurrences
    FROM users u, LATERAL jsonb_array_elements_text(u.roles) AS r(role)
   WHERE u.user_id = '0fcb97be-5915-4fab-addd-bd2faa9e468d'
     AND r.role = 'provisioner';

  IF occurrences <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 provisioner role entry, found %', occurrences;
  END IF;
END $$;

COMMIT;
\echo == done — nikola must LOG OUT AND BACK IN for the new token to carry provisionerProviders ==
