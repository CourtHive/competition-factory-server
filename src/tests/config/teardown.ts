/**
 * Jest globalTeardown — wipes well-known test-pattern rows from Postgres
 * after the full test suite finishes.
 *
 * This is a safety net: every spec is also expected to clean up after
 * itself in afterAll/afterEach. But many unit + integration specs that
 * boot the real AppModule write tournaments through to Postgres and
 * forget to remove them. Without this, every `pnpm test` run leaks
 * rows.
 *
 * Skips silently if STORAGE_PROVIDER !== 'postgres' or PG_* env vars
 * are not set — the file-storage and leveldb paths don't need it.
 *
 * Patterns matched here mirror src/scripts/cleanup-test-data.mjs and
 * are intentionally narrow: test-only data with deterministic markers.
 *
 * Persistent fixtures (NEVER touched):
 *   - users e2e-admin@courthive.test, e2e-client@courthive.com
 *   - provisioners.name = 'IONSport'
 */
import 'dotenv/config';

module.exports = async function teardown() {
  if (process.env.STORAGE_PROVIDER !== 'postgres') return;
  if (!process.env.PG_HOST || !process.env.PG_DATABASE) return;

  // Lazy-load pg so leveldb-only environments don't pay the cost.
  const pg = await import('pg');
  const pool = new pg.default.Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT ? Number.parseInt(process.env.PG_PORT, 10) : 5432,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Order: dependents first.
    // Tournaments — match by deterministic test names + audit-e2e- id +
    // the synthetic 'test-provider' literal used by unit specs.
    await client.query(
      `DELETE FROM tournaments
         WHERE provider_id IN (
           SELECT provider_id FROM providers
            WHERE organisation_abbreviation LIKE 'E2E%'
               OR organisation_abbreviation LIKE 'AUDITE2E%'
         )
            OR provider_id = 'test-provider'
            OR tournament_id LIKE 'audit-e2e-%'
            OR tournament_name IN ('E2E Provisioner Tournament','Assignment Test','Audit Trail Test')`,
    );

    await client.query(
      `DELETE FROM audit_log WHERE tournament_id LIKE 'audit-e2e-%'`,
    );

    await client.query(
      `DELETE FROM calendars
         WHERE provider_abbr IN (
           SELECT organisation_abbreviation FROM providers
            WHERE organisation_abbreviation LIKE 'E2E%'
               OR organisation_abbreviation LIKE 'AUDITE2E%'
         )`,
    );

    // Provisioners — explicit cascade since FK is plain (no ON DELETE).
    const provIds = (await client.query(
      `SELECT provisioner_id FROM provisioners WHERE name LIKE 'E2E-Provisioner-%'`,
    )).rows.map((r) => r.provisioner_id);
    if (provIds.length > 0) {
      await client.query(`DELETE FROM provisioner_api_keys WHERE provisioner_id = ANY($1::uuid[])`, [provIds]);
      await client.query(`DELETE FROM provisioner_providers WHERE provisioner_id = ANY($1::uuid[])`, [provIds]);
      await client.query(`DELETE FROM tournament_provisioner WHERE provisioner_id = ANY($1::uuid[])`, [provIds]);
      await client.query(`DELETE FROM user_provisioners WHERE provisioner_id = ANY($1::uuid[])`, [provIds]);
      await client.query(`DELETE FROM provisioners WHERE provisioner_id = ANY($1::uuid[])`, [provIds]);
    }

    // Users (FK CASCADE handles sso_identities / tournament_assignments /
    // user_providers / user_provisioners on the schema side).
    await client.query(`DELETE FROM users WHERE email LIKE 'e2e-sso-%@test.com'`);

    await client.query(
      `DELETE FROM providers
         WHERE organisation_abbreviation LIKE 'E2E%'
            OR organisation_abbreviation LIKE 'AUDITE2E%'`,
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
     
    console.warn('[jest globalTeardown] cleanup failed:', (err as Error).message);
  } finally {
    client.release();
    await pool.end();
  }
};
