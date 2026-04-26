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
  string: ['ids', 'name-pattern'],
  boolean: ['execute', 'help', 'list', 'force'],
  alias: { h: 'help', l: 'list' },
});

if (args.help || (!args.ids && !args.list && !args['name-pattern'])) {
  console.log(`
Cleanup Test Provisioners

Usage:
  node src/scripts/cleanup-test-provisioners.mjs --list
  node src/scripts/cleanup-test-provisioners.mjs --ids "<id1>,<id2>" [--execute]
  node src/scripts/cleanup-test-provisioners.mjs --name-pattern "<substring>" [--force] [--execute]

Options:
  --list             Print all provisioners. No deletion.
  --ids              Comma-separated list of provisioner IDs to delete.
  --name-pattern     Substring to match against provisioner name (e.g.
                     "E2E-Provisioner-"). Resolves to a list of IDs.
  --force            Bypass the deactivate-first safeguard (deletes ACTIVE
                     provisioners). Use only for one-off cleanup of test data.
  --execute          Actually delete. Without this flag the script runs in dry mode.

Examples:
  # Discover what's in the database
  node src/scripts/cleanup-test-provisioners.mjs --list

  # Preview cascade by ID
  node src/scripts/cleanup-test-provisioners.mjs --ids "abc123,def456"

  # Bulk wipe e2e test rows (one-off cleanup of forgotten teardowns)
  node src/scripts/cleanup-test-provisioners.mjs --name-pattern "E2E-Provisioner-" --force
  node src/scripts/cleanup-test-provisioners.mjs --name-pattern "E2E-Provisioner-" --force --execute
`);
  process.exit(args.help ? 0 : 1);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const explicitIds = args.ids
  ? String(args.ids).split(',').map((s) => s.trim()).filter(Boolean)
  : [];

if (!args.list && !args['name-pattern']) {
  if (explicitIds.length === 0) {
    console.error('No provisioner IDs supplied.');
    process.exit(1);
  }

  const invalid = explicitIds.filter((id) => !UUID_RE.test(id));
  if (invalid.length > 0) {
    console.error('The following ID(s) are not valid UUIDs:');
    for (const bad of invalid) console.error(`  - ${bad}`);
    if (invalid.some((id) => id.startsWith('<') && id.endsWith('>'))) {
      console.error("\nThose look like placeholders. Replace them with real provisioner UUIDs.");
      console.error("Tip: run with --list to see the actual IDs.");
    }
    process.exit(1);
  }
}

const dryRun = !args.execute;
const force = !!args.force;
const namePattern = args['name-pattern'] ? String(args['name-pattern']) : null;

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

  // Run sequentially — pg client doesn't support concurrent queries on the
  // same client (deprecation warning otherwise).
  const keys = await client.query('SELECT COUNT(*)::int AS n FROM provisioner_api_keys WHERE provisioner_id = $1', [id]);
  const assoc = await client.query('SELECT COUNT(*)::int AS n FROM provisioner_providers WHERE provisioner_id = $1', [id]);
  const stamps = await client.query('SELECT COUNT(*)::int AS n FROM tournament_provisioner WHERE provisioner_id = $1', [id]);

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

async function listAll(client) {
  const provs = await client.query(
    'SELECT provisioner_id, name, is_active, created_at FROM provisioners ORDER BY created_at',
  );
  if (provs.rows.length === 0) {
    console.log('No provisioners found.');
    return;
  }

  console.log(`Found ${provs.rows.length} provisioner(s):\n`);
  for (const row of provs.rows) {
    const desc = await describeProvisioner(client, row.provisioner_id);
    const status = desc.isActive ? '\x1b[33mACTIVE\x1b[0m   ' : 'inactive ';
    const counts = desc.counts;
    console.log(`  ${row.provisioner_id}  [${status}]  ${row.name}`);
    console.log(
      `    ${counts.apiKeys} key(s), ${counts.providerAssociations} association(s), ${counts.tournamentStamps} tournament stamp(s)`,
    );
  }
  console.log(`\nTo clean up, deactivate the target(s) first (UI or PATCH) then run:`);
  console.log(`  node src/scripts/cleanup-test-provisioners.mjs --ids "<id1>,<id2>" --execute`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();

  if (args.list) {
    try {
      await listAll(client);
    } finally {
      client.release();
      await pool.end();
    }
    process.exit(0);
  }

  // Resolve target IDs from --ids and/or --name-pattern (deduplicated)
  const idSet = new Set(explicitIds);
  if (namePattern) {
    const result = await client.query(
      'SELECT provisioner_id, name FROM provisioners WHERE name ILIKE $1 ORDER BY name',
      [`%${namePattern}%`],
    );
    if (result.rows.length === 0) {
      console.log(`No provisioners matched name-pattern "${namePattern}".`);
      client.release();
      await pool.end();
      process.exit(0);
    }
    for (const row of result.rows) idSet.add(row.provisioner_id);
    console.log(`Pattern "${namePattern}" matched ${result.rows.length} provisioner(s).`);
  }

  const ids = [...idSet];
  if (ids.length === 0) {
    console.error('No targets resolved.');
    client.release();
    await pool.end();
    process.exit(1);
  }

  console.log(`Mode: ${dryRun ? 'DRY-RUN (no changes will be made)' : 'EXECUTE (provisioners will be deleted)'}`);
  if (force) console.log(`\x1b[33mForce: active provisioners will be deleted without deactivation.\x1b[0m`);
  console.log(`Targets: ${ids.length} provisioner ID(s)\n`);

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

      if (desc.isActive && !force) {
        console.log(`    skipped — provisioner is still active. Pass --force to override, or deactivate via UI first.`);
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
