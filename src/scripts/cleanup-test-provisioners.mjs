/**
 * One-shot cleanup script for test provisioners.
 *
 * Hard-deletes specific provisioners (by ID) with the same cascade rules as
 * the `DELETE /admin/provisioners/:id` endpoint:
 *   - provisioner_api_keys             — deleted
 *   - provisioner_providers            — associations deleted (providers stay)
 *   - tournament_provisioner           — ownership stamps deleted (tournaments stay)
 *   - provisioners                     — row deleted
 *
 * Always pass explicit IDs (no pattern matching) so it's impossible to delete
 * the wrong provisioner via a typo. Defaults to dry-run; you must explicitly
 * pass --execute to actually delete anything.
 *
 * Prerequisites:
 *   - PG_* vars in .env (host, port, user, password, database)
 *
 * Usage:
 *   node src/scripts/cleanup-test-provisioners.mjs --ids "<uuid1>,<uuid2>"
 *   node src/scripts/cleanup-test-provisioners.mjs --ids "<uuid1>,<uuid2>" --execute
 */

import minimist from 'minimist';
import pg from 'pg';
import 'dotenv/config';

const args = minimist(process.argv.slice(2).filter((a) => a !== '--'), {
  string: ['ids'],
  boolean: ['execute', 'help'],
  alias: { h: 'help' },
});

if (args.help || !args.ids) {
  console.log(`
Cleanup Test Provisioners

Usage:
  node src/scripts/cleanup-test-provisioners.mjs --ids "<id1>,<id2>" [--execute]

Options:
  --ids       Comma-separated list of provisioner IDs to delete (required)
  --execute   Actually delete. Without this flag the script runs in dry mode.

Examples:
  # Preview cascade for two provisioners
  node src/scripts/cleanup-test-provisioners.mjs --ids "abc123,def456"

  # Actually delete them
  node src/scripts/cleanup-test-provisioners.mjs --ids "abc123,def456" --execute
`);
  process.exit(args.help ? 0 : 1);
}

const ids = String(args.ids)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (ids.length === 0) {
  console.error('No provisioner IDs supplied.');
  process.exit(1);
}

const dryRun = !args.execute;

// ── Postgres connection ──────────────────────────────────────────────

const pool = new pg.Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT ? Number.parseInt(process.env.PG_PORT, 10) : 5432,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

// ── Discovery ────────────────────────────────────────────────────────

async function describeProvisioner(client, id) {
  const provRes = await client.query(
    'SELECT provisioner_id, name, is_active FROM provisioners WHERE provisioner_id = $1',
    [id],
  );
  if (!provRes.rows.length) return { id, found: false };

  const [keys, assoc, stamps] = await Promise.all([
    client.query('SELECT COUNT(*)::int AS n FROM provisioner_api_keys WHERE provisioner_id = $1', [id]),
    client.query('SELECT COUNT(*)::int AS n FROM provisioner_providers WHERE provisioner_id = $1', [id]),
    client.query('SELECT COUNT(*)::int AS n FROM tournament_provisioner WHERE provisioner_id = $1', [id]),
  ]);

  return {
    id,
    found: true,
    name: provRes.rows[0].name,
    isActive: provRes.rows[0].is_active,
    counts: {
      apiKeys: keys.rows[0].n,
      providerAssociations: assoc.rows[0].n,
      tournamentStamps: stamps.rows[0].n,
    },
  };
}

async function deleteWithCascade(client, id) {
  await client.query('BEGIN');
  try {
    const k = await client.query('DELETE FROM provisioner_api_keys WHERE provisioner_id = $1', [id]);
    const a = await client.query('DELETE FROM provisioner_providers WHERE provisioner_id = $1', [id]);
    const s = await client.query('DELETE FROM tournament_provisioner WHERE provisioner_id = $1', [id]);
    await client.query('DELETE FROM provisioners WHERE provisioner_id = $1', [id]);
    await client.query('COMMIT');
    return {
      apiKeys: k.rowCount ?? 0,
      providerAssociations: a.rowCount ?? 0,
      tournamentStamps: s.rowCount ?? 0,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`Mode: ${dryRun ? 'DRY-RUN (no changes will be made)' : 'EXECUTE (provisioners will be deleted)'}`);
  console.log(`Targets: ${ids.length} provisioner ID(s)\n`);

  const client = await pool.connect();
  let failures = 0;
  let totals = { apiKeys: 0, providerAssociations: 0, tournamentStamps: 0, deleted: 0 };

  try {
    for (const id of ids) {
      const desc = await describeProvisioner(client, id);
      if (!desc.found) {
        console.log(`✘ ${id}  not found — skipping`);
        failures += 1;
        continue;
      }

      const status = desc.isActive ? '\x1b[33mACTIVE\x1b[0m' : 'inactive';
      console.log(`• ${desc.name}  (${id})  [${status}]`);
      console.log(
        `    cascade: ${desc.counts.apiKeys} key(s), ${desc.counts.providerAssociations} association(s), ${desc.counts.tournamentStamps} tournament stamp(s)`,
      );

      if (dryRun) continue;

      if (desc.isActive) {
        console.log(`    skipped — provisioner is still active. Deactivate via UI or PATCH first.`);
        failures += 1;
        continue;
      }

      try {
        const counts = await deleteWithCascade(client, id);
        totals.apiKeys += counts.apiKeys;
        totals.providerAssociations += counts.providerAssociations;
        totals.tournamentStamps += counts.tournamentStamps;
        totals.deleted += 1;
        console.log(`    \x1b[32m✓ deleted\x1b[0m`);
      } catch (err) {
        console.error(`    \x1b[31m✘ failed: ${err.message}\x1b[0m`);
        failures += 1;
      }
    }

    console.log();
    if (dryRun) {
      console.log(`Dry-run complete. Re-run with --execute to apply.`);
    } else {
      console.log(
        `Done. Deleted ${totals.deleted} provisioner(s). Cascade totals: ${totals.apiKeys} keys, ${totals.providerAssociations} associations, ${totals.tournamentStamps} stamps.`,
      );
    }
    if (failures > 0) console.log(`${failures} target(s) skipped or failed.`);
  } finally {
    client.release();
    await pool.end();
  }

  process.exit(failures > 0 && !dryRun ? 1 : 0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  pool.end().catch(() => {});
  process.exit(1);
});
