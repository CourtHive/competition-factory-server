-- 2026-05-17-ionsport-kronos.sql
--
-- Establishes IONSport as a provisioner and grants it `owner` of the
-- existing Kronos Sports provider, then backfills tournament_provisioner
-- ownership stamps for every tournament currently owned by Kronos so that
-- subsidiary-access logic treats IONSport as effective owner everywhere.
--
-- Idempotent and transaction-wrapped. Safe to re-run; ON CONFLICT clauses
-- absorb the second pass.
--
-- Battle of Boca (provider + tournament moves + calendar reconciliation)
-- is intentionally NOT covered here — it ships in a follow-up script after
-- the in-flight 2026-05-16 BoB tournament wraps on 2026-05-19.
--
-- Usage on courthive-mentat (writes against the nest prod DB):
--
--   PGPASSWORD=courthive_dev psql -h 10.128.0.4 -U tennis_aip -d courthive \
--     -f src/scripts/data-fixes/2026-05-17-ionsport-kronos.sql

\set ON_ERROR_STOP on
BEGIN;

-- ============================================================================
-- 1) Create the IONSport provisioner (idempotent via unique name index)
-- ============================================================================
-- Uses a no-op UPDATE on the conflict path so RETURNING fires either way and
-- gives us the provisioner_id to thread into the next statements via \gset.

INSERT INTO provisioners (name, is_active, config)
VALUES ('IONSport', true, '{}'::jsonb)
ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
RETURNING provisioner_id AS ionsport_id \gset

\echo == IONSport provisioner ==
SELECT provisioner_id, name, is_active, created_at
  FROM provisioners
 WHERE provisioner_id = :'ionsport_id';

-- ============================================================================
-- 2) Grant IONSport `owner` of Kronos Sports
-- ============================================================================
-- Kronos provider id resolved by preflight on 2026-05-17 (single match by
-- organisation_name ILIKE '%Kronos%'). Hardcoded here so the script is a
-- record of exactly what was changed.

\set kronos_id '''c2545522-bbd7-451c-8be1-5fd88c62ed82'''

INSERT INTO provisioner_providers (provisioner_id, provider_id, relationship)
VALUES (:'ionsport_id', :kronos_id, 'owner')
ON CONFLICT (provisioner_id, provider_id) DO UPDATE
  SET relationship = EXCLUDED.relationship;

\echo == provisioner_providers row ==
SELECT pp.provisioner_id, p.name AS provisioner_name, pp.provider_id,
       pr.organisation_abbreviation, pr.organisation_name, pp.relationship
  FROM provisioner_providers pp
  JOIN provisioners p  ON p.provisioner_id  = pp.provisioner_id
  JOIN providers   pr ON pr.provider_id    = pp.provider_id
 WHERE pp.provider_id = :kronos_id;

-- ============================================================================
-- 3) Backfill tournament_provisioner stamps for every Kronos tournament
-- ============================================================================
-- Stamp = (tournament_id, ionsport_id, kronos_id). ON CONFLICT DO NOTHING
-- protects re-runs and any tournaments that already happen to be stamped.

INSERT INTO tournament_provisioner (tournament_id, provisioner_id, provider_id)
SELECT t.tournament_id, :'ionsport_id', t.provider_id
  FROM tournaments t
 WHERE t.provider_id = :kronos_id
ON CONFLICT (tournament_id) DO NOTHING;

\echo == Kronos tournaments now stamped to IONSport ==
SELECT t.tournament_id, t.tournament_name, tp.provisioner_id, tp.provider_id, tp.created_at
  FROM tournaments t
  LEFT JOIN tournament_provisioner tp ON tp.tournament_id = t.tournament_id
 WHERE t.provider_id = :kronos_id
 ORDER BY t.start_date NULLS LAST, t.tournament_id;

\echo == Summary ==
SELECT
  (SELECT COUNT(*) FROM tournaments WHERE provider_id = :kronos_id) AS kronos_tournaments,
  (SELECT COUNT(*) FROM tournament_provisioner tp
     JOIN tournaments t ON t.tournament_id = tp.tournament_id
    WHERE t.provider_id = :kronos_id
      AND tp.provisioner_id = :'ionsport_id') AS stamped_to_ionsport;

-- ============================================================================
-- 4) Promote admin@ioncourt.com to IONSport provisioner representative
-- ============================================================================
-- Mirrors ProvisionerService.assignUserToProvisioner:
--   (a) idempotently graft the global 'provisioner' role onto users.roles
--   (b) INSERT into user_provisioners (idempotent via composite PK)
-- granted_by is left NULL — there is no actor session for a SQL data-fix.
-- After next login, admin@ioncourt.com's JWT will carry roles:['provisioner']
-- + provisionerIds:['<ionsport>'] and the login redirect will land them in the
-- /provisioner workspace.

UPDATE users
   SET roles = roles || '"provisioner"'::jsonb,
       updated_at = NOW()
 WHERE email = 'admin@ioncourt.com'
   AND NOT (roles ? 'provisioner');

INSERT INTO user_provisioners (user_id, provisioner_id)
SELECT u.user_id, :'ionsport_id'
  FROM users u
 WHERE u.email = 'admin@ioncourt.com'
ON CONFLICT (user_id, provisioner_id) DO NOTHING;

\echo == admin@ioncourt.com after promotion ==
SELECT u.user_id, u.email, u.roles, up.provisioner_id, up.created_at AS assigned_at
  FROM users u
  LEFT JOIN user_provisioners up
    ON up.user_id = u.user_id AND up.provisioner_id = :'ionsport_id'
 WHERE u.email = 'admin@ioncourt.com';

COMMIT;
\echo == done ==
