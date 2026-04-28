/**
 * One-shot cleanup script for accumulated test data.
 *
 * Wipes test rows produced by the e2e test suites that didn't tear down
 * cleanly. Targets only rows matching the documented test patterns:
 *
 *   - provisioners.name LIKE 'E2E-Provisioner-%'  (provisioner.e2e.spec)
 *   - providers WHERE organisation_abbreviation LIKE 'E2E%' OR 'AUDITE2E%'
 *   - users.email LIKE 'e2e-sso-%@test.com'  (provisioner.e2e.spec)
 *   - tournaments under any test provider above
 *   - calendars under any test provider abbreviation above
 *   - audit_log rows for tournament_id LIKE 'audit-e2e-%'
 *
 * Cascade order is bottom-up so orphan FK references are removed first.
 * Defaults to dry-run; pass --execute to actually delete anything.
 *
 * Persistent fixtures are NEVER touched:
 *   - users.email = 'e2e-admin@courthive.test'  (global-setup super-admin)
 *   - users.email = 'e2e-client@courthive.com'  (TMX fixture)
 *   - provisioners.name = 'IONSport'            (real provisioner)
 *
 * Prerequisites:
 *   - PG_* vars in .env (host, port, user, password, database)
 *
 * Usage:
 *   node src/scripts/cleanup-test-data.mjs              # dry-run, full preview
 *   node src/scripts/cleanup-test-data.mjs --execute    # actually delete
 *   node src/scripts/cleanup-test-data.mjs --buckets provisioners,providers
 */

import minimist from 'minimist';
import pg from 'pg';
import 'dotenv/config';

const args = minimist(process.argv.slice(2).filter((a) => a !== '--'), {
  string: ['buckets'],
  boolean: ['execute', 'help'],
  alias: { h: 'help' },
});

if (args.help) {
  console.log(`
Cleanup Test Data

Usage:
  node src/scripts/cleanup-test-data.mjs [--buckets <list>] [--execute]

Options:
  --buckets    Comma-separated list of buckets to clean. Default: all.
               Available: provisioners, providers, tournaments, calendars,
                          users, audit_log
  --execute    Actually delete. Without this flag the script runs in dry mode.
  -h, --help   Show this message.

Patterns matched (read-only, hard-coded):
  - provisioners.name LIKE 'E2E-Provisioner-%'
  - providers WHERE organisation_abbreviation LIKE 'E2E%' OR 'AUDITE2E%'
  - users.email LIKE 'e2e-sso-%@test.com'
  - tournaments under any matched test provider
  - calendars under any matched test provider abbreviation
  - audit_log rows where tournament_id LIKE 'audit-e2e-%'

Persistent fixtures (NEVER touched):
  - users e2e-admin@courthive.test, e2e-client@courthive.com
  - provisioners.name = 'IONSport'
`);
  process.exit(0);
}

const dryRun = !args.execute;

const ALL_BUCKETS = ['provisioners', 'providers', 'tournaments', 'calendars', 'users', 'audit_log'];
const requestedBuckets = args.buckets
  ? String(args.buckets).split(',').map((s) => s.trim()).filter(Boolean)
  : ALL_BUCKETS;

const invalidBuckets = requestedBuckets.filter((b) => !ALL_BUCKETS.includes(b));
if (invalidBuckets.length > 0) {
  console.error(`Unknown bucket(s): ${invalidBuckets.join(', ')}`);
  console.error(`Available buckets: ${ALL_BUCKETS.join(', ')}`);
  process.exit(1);
}

const enabled = (b) => requestedBuckets.includes(b);

// ── Postgres connection ──────────────────────────────────────────────

const pool = new pg.Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT ? Number.parseInt(process.env.PG_PORT, 10) : 5432,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

// ── Pattern queries (single source of truth) ─────────────────────────

const PROVIDER_WHERE = `(organisation_abbreviation LIKE 'E2E%' OR organisation_abbreviation LIKE 'AUDITE2E%')`;
const USER_EMAIL_LIKE = `email LIKE 'e2e-sso-%@test.com'`;
const PROVISIONER_NAME_LIKE = `name LIKE 'E2E-Provisioner-%'`;
const AUDIT_TOURNAMENT_LIKE = `tournament_id LIKE 'audit-e2e-%'`;
// Orphan tournaments left by historical test runs whose provider was
// deleted before the tournament — match by deterministic test names,
// the synthetic 'test-provider' literal used by unit specs, and the
// audit-e2e- tournament_id pattern.
const ORPHAN_TOURNAMENT_NAMES = `tournament_name IN ('E2E Provisioner Tournament','Assignment Test','Audit Trail Test')`;
const ORPHAN_TOURNAMENT_WHERE = `(${ORPHAN_TOURNAMENT_NAMES} OR tournament_id LIKE 'audit-e2e-%' OR provider_id = 'test-provider')`;

// ── Discovery ────────────────────────────────────────────────────────

async function preview(client) {
  const rows = {};

  rows.provisioners = (await client.query(
    `SELECT COUNT(*)::int AS n FROM provisioners WHERE ${PROVISIONER_NAME_LIKE}`,
  )).rows[0].n;
  rows.provisionerCascade = {
    apiKeys: (await client.query(
      `SELECT COUNT(*)::int AS n FROM provisioner_api_keys WHERE provisioner_id IN (SELECT provisioner_id FROM provisioners WHERE ${PROVISIONER_NAME_LIKE})`,
    )).rows[0].n,
    associations: (await client.query(
      `SELECT COUNT(*)::int AS n FROM provisioner_providers WHERE provisioner_id IN (SELECT provisioner_id FROM provisioners WHERE ${PROVISIONER_NAME_LIKE})`,
    )).rows[0].n,
    stamps: (await client.query(
      `SELECT COUNT(*)::int AS n FROM tournament_provisioner WHERE provisioner_id IN (SELECT provisioner_id FROM provisioners WHERE ${PROVISIONER_NAME_LIKE})`,
    )).rows[0].n,
    userAssoc: (await client.query(
      `SELECT COUNT(*)::int AS n FROM user_provisioners WHERE provisioner_id IN (SELECT provisioner_id FROM provisioners WHERE ${PROVISIONER_NAME_LIKE})`,
    )).rows[0].n,
  };

  rows.providers = (await client.query(
    `SELECT COUNT(*)::int AS n FROM providers WHERE ${PROVIDER_WHERE}`,
  )).rows[0].n;
  // Match tournaments two ways: (a) under a still-present test provider,
  // and (b) orphan rows whose provider has already been deleted but the
  // deterministic test name / id pattern identifies them.
  rows.tournaments = (await client.query(
    `SELECT COUNT(*)::int AS n FROM tournaments WHERE provider_id IN (SELECT provider_id FROM providers WHERE ${PROVIDER_WHERE}) OR ${ORPHAN_TOURNAMENT_WHERE}`,
  )).rows[0].n;
  rows.calendars = (await client.query(
    `SELECT COUNT(*)::int AS n FROM calendars WHERE provider_abbr IN (SELECT organisation_abbreviation FROM providers WHERE ${PROVIDER_WHERE})`,
  )).rows[0].n;

  rows.users = (await client.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE ${USER_EMAIL_LIKE}`,
  )).rows[0].n;
  rows.userCascade = {
    sso: (await client.query(
      `SELECT COUNT(*)::int AS n FROM sso_identities WHERE user_id IN (SELECT user_id FROM users WHERE ${USER_EMAIL_LIKE})`,
    )).rows[0].n,
    assignments: (await client.query(
      `SELECT COUNT(*)::int AS n FROM tournament_assignments WHERE user_id IN (SELECT user_id FROM users WHERE ${USER_EMAIL_LIKE})`,
    )).rows[0].n,
    providers: (await client.query(
      `SELECT COUNT(*)::int AS n FROM user_providers WHERE user_id IN (SELECT user_id FROM users WHERE ${USER_EMAIL_LIKE})`,
    )).rows[0].n,
    provisioners: (await client.query(
      `SELECT COUNT(*)::int AS n FROM user_provisioners WHERE user_id IN (SELECT user_id FROM users WHERE ${USER_EMAIL_LIKE})`,
    )).rows[0].n,
  };

  rows.auditRows = (await client.query(
    `SELECT COUNT(*)::int AS n FROM audit_log WHERE ${AUDIT_TOURNAMENT_LIKE}`,
  )).rows[0].n;

  return rows;
}

function printPreview(rows) {
  console.log('Test data preview (matching documented patterns):');
  console.log(`  provisioners (E2E-Provisioner-*):       ${rows.provisioners}`);
  console.log(`    cascade: api_keys=${rows.provisionerCascade.apiKeys}  prov_providers=${rows.provisionerCascade.associations}  tournament_stamps=${rows.provisionerCascade.stamps}  user_assoc=${rows.provisionerCascade.userAssoc}`);
  console.log(`  providers (E2E* / AUDITE2E*):           ${rows.providers}`);
  console.log(`  tournaments under test providers:       ${rows.tournaments}`);
  console.log(`  calendars under test providers:         ${rows.calendars}`);
  console.log(`  users (e2e-sso-*@test.com):             ${rows.users}`);
  console.log(`    cascade: sso_identities=${rows.userCascade.sso}  assignments=${rows.userCascade.assignments}  user_providers=${rows.userCascade.providers}  user_provisioners=${rows.userCascade.provisioners}`);
  console.log(`  audit_log (audit-e2e-* tournaments):    ${rows.auditRows}`);
}

// ── Deletion (transactional) ─────────────────────────────────────────

async function deleteProvisioners(client) {
  const ids = (await client.query(
    `SELECT provisioner_id FROM provisioners WHERE ${PROVISIONER_NAME_LIKE}`,
  )).rows.map((r) => r.provisioner_id);
  if (ids.length === 0) return { deleted: 0 };

  await client.query(`DELETE FROM provisioner_api_keys WHERE provisioner_id = ANY($1::uuid[])`, [ids]);
  await client.query(`DELETE FROM provisioner_providers WHERE provisioner_id = ANY($1::uuid[])`, [ids]);
  await client.query(`DELETE FROM tournament_provisioner WHERE provisioner_id = ANY($1::uuid[])`, [ids]);
  await client.query(`DELETE FROM user_provisioners WHERE provisioner_id = ANY($1::uuid[])`, [ids]);
  const r = await client.query(`DELETE FROM provisioners WHERE provisioner_id = ANY($1::uuid[])`, [ids]);
  return { deleted: r.rowCount ?? 0 };
}

async function deleteTournaments(client) {
  const r = await client.query(
    `DELETE FROM tournaments WHERE provider_id IN (SELECT provider_id FROM providers WHERE ${PROVIDER_WHERE}) OR ${ORPHAN_TOURNAMENT_WHERE}`,
  );
  return { deleted: r.rowCount ?? 0 };
}

async function deleteCalendars(client) {
  const r = await client.query(
    `DELETE FROM calendars WHERE provider_abbr IN (SELECT organisation_abbreviation FROM providers WHERE ${PROVIDER_WHERE})`,
  );
  return { deleted: r.rowCount ?? 0 };
}

async function deleteProviders(client) {
  const r = await client.query(`DELETE FROM providers WHERE ${PROVIDER_WHERE}`);
  return { deleted: r.rowCount ?? 0 };
}

async function deleteUsers(client) {
  // tournament_assignments / sso_identities / user_providers / user_provisioners
  // all ON DELETE CASCADE from users — single DELETE handles them.
  const r = await client.query(`DELETE FROM users WHERE ${USER_EMAIL_LIKE}`);
  return { deleted: r.rowCount ?? 0 };
}

async function deleteAuditLog(client) {
  const r = await client.query(`DELETE FROM audit_log WHERE ${AUDIT_TOURNAMENT_LIKE}`);
  return { deleted: r.rowCount ?? 0 };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();

  try {
    console.log(`Mode: ${dryRun ? 'DRY-RUN (no changes will be made)' : 'EXECUTE (rows will be deleted)'}`);
    console.log(`Buckets: ${requestedBuckets.join(', ')}\n`);

    const before = await preview(client);
    printPreview(before);

    if (dryRun) {
      console.log('\nDry-run complete. Re-run with --execute to apply.');
      return;
    }

    console.log('\nExecuting deletions in cascade-safe order...\n');
    await client.query('BEGIN');
    try {
      const results = {};
      // Order: dependents first.
      // 1. audit_log — tournament-id-keyed, no FK, can run anytime.
      if (enabled('audit_log')) results.audit = await deleteAuditLog(client);
      // 2. tournaments — depends on providers (string FK, no constraint).
      if (enabled('tournaments')) results.tournaments = await deleteTournaments(client);
      // 3. calendars — depends on provider_abbreviation (no FK).
      if (enabled('calendars')) results.calendars = await deleteCalendars(client);
      // 4. provisioners — cascade handles its child tables explicitly.
      if (enabled('provisioners')) results.provisioners = await deleteProvisioners(client);
      // 5. users — FK CASCADE via DB schema handles sso_identities, etc.
      if (enabled('users')) results.users = await deleteUsers(client);
      // 6. providers — last (other tables refer to it by string id).
      if (enabled('providers')) results.providers = await deleteProviders(client);

      await client.query('COMMIT');

      console.log('Deletion summary:');
      for (const [bucket, r] of Object.entries(results)) {
        console.log(`  ${bucket.padEnd(14)} ${r.deleted} row(s) deleted`);
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    console.log('\nPost-cleanup verification:');
    const after = await preview(client);
    printPreview(after);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  pool.end().catch(() => {});
  process.exit(1);
});
