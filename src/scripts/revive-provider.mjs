#!/usr/bin/env node
/**
 * revive-provider.mjs — restore an archived provider's rows.
 *
 * Reads an archive directory written by ProviderArchiveService,
 * verifies the manifest sha256 against the recorded one in
 * provider_archives, then INSERTs every row back in a single
 * transaction. Refuses to overwrite a provider_id that's already
 * present in the live DB.
 *
 * Usage:
 *   node src/scripts/revive-provider.mjs <archive-path>
 *   node src/scripts/revive-provider.mjs <archive-path> --yes      (skip confirm)
 *   node src/scripts/revive-provider.mjs --by-id <archive_uuid>    (look up path)
 *   node src/scripts/revive-provider.mjs --help
 *
 * No HTTP endpoint exists for revive — this is deliberately backend-
 * only per the Plan A design. Revive should require an operator who
 * has SSH access to the box anyway.
 *
 * Exit codes:
 *   0  success
 *   1  configuration / argument error
 *   2  archive integrity check failed
 *   3  conflict (provider_id already exists in live DB)
 *   4  restore transaction failed
 */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import minimist from 'minimist';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const args = minimist(process.argv.slice(2), {
  boolean: ['yes', 'help'],
  string: ['by-id'],
  alias: { h: 'help', y: 'yes' },
});

if (args.help) {
  console.error(`Usage: node src/scripts/revive-provider.mjs <archive-path> [--yes]
       node src/scripts/revive-provider.mjs --by-id <archive_uuid> [--yes]

Reads an archive directory, verifies the manifest, and restores every row
back to the live DB in a single transaction.

Flags:
  --yes        Skip the interactive confirmation prompt
  --by-id ID   Look up the archive_path via the provider_archives table
  -h, --help   Show this`);
  process.exit(0);
}

const pool = new Pool({
  host:     process.env.PG_HOST,
  port:     process.env.PG_PORT ? Number(process.env.PG_PORT) : undefined,
  user:     process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

async function resolveArchivePath() {
  if (args['by-id']) {
    const r = await pool.query(
      `SELECT archive_path, manifest_sha256, revived_at
         FROM provider_archives
        WHERE archive_id = $1`,
      [args['by-id']],
    );
    if (!r.rows.length) {
      console.error(`No provider_archives row with archive_id = ${args['by-id']}`);
      process.exit(1);
    }
    if (r.rows[0].revived_at) {
      console.error(
        `Warning: archive ${args['by-id']} was already revived at ${r.rows[0].revived_at}. Proceeding anyway — revive is idempotent at the row level only if the provider was archived again in between.`,
      );
    }
    return { path: r.rows[0].archive_path, expectedSha: r.rows[0].manifest_sha256 };
  }
  const p = args._[0];
  if (!p) {
    console.error('archive-path or --by-id is required. Run with --help for usage.');
    process.exit(1);
  }
  return { path: p, expectedSha: null };
}

async function loadManifest(archivePath) {
  const manifestText = await fs.readFile(path.join(archivePath, 'manifest.json'), 'utf8');
  const manifestSha = createHash('sha256').update(manifestText).digest('hex');
  const manifest = JSON.parse(manifestText);
  return { manifest, manifestSha, manifestText };
}

async function verifyPayloadFiles(archivePath, manifest) {
  for (const [rel, meta] of Object.entries(manifest.files)) {
    const buf = await fs.readFile(path.join(archivePath, rel));
    const sha = createHash('sha256').update(buf).digest('hex');
    if (sha !== meta.sha256) {
      console.error(`Integrity check failed for ${rel}: expected ${meta.sha256}, got ${sha}`);
      process.exit(2);
    }
  }
}

async function readJson(archivePath, rel) {
  const text = await fs.readFile(path.join(archivePath, rel), 'utf8');
  return JSON.parse(text);
}

async function readJsonl(archivePath, rel) {
  const text = await fs.readFile(path.join(archivePath, rel), 'utf8');
  if (!text.trim()) return [];
  return text.trimEnd().split('\n').map((line) => JSON.parse(line));
}

async function confirm(prompt) {
  if (args.yes) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

function columns(rows) {
  if (!rows?.length) return [];
  return Object.keys(rows[0]);
}

async function insertRows(client, table, rows) {
  if (!rows?.length) return 0;
  const cols = columns(rows);
  // Build a parameterised multi-row INSERT. Slow path but reliable for
  // archives that fit in memory (a single provider's data should always
  // fit — if it doesn't, the archive itself wouldn't have been built).
  const placeholders = rows
    .map((_, i) => `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(',')})`)
    .join(',');
  const params = rows.flatMap((row) => cols.map((c) => row[c]));
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES ${placeholders}`;
  await client.query(sql, params);
  return rows.length;
}

async function main() {
  const { path: archivePath, expectedSha } = await resolveArchivePath();

  console.error(`Reading archive: ${archivePath}`);
  const { manifest, manifestSha } = await loadManifest(archivePath);

  if (expectedSha && expectedSha !== manifestSha) {
    console.error(
      `Manifest sha mismatch: provider_archives row records ${expectedSha} but the archive's manifest hashes to ${manifestSha}. The archive directory may have been tampered with.`,
    );
    process.exit(2);
  }

  await verifyPayloadFiles(archivePath, manifest);
  console.error(`Manifest verified. Provider: ${manifest.providerName} (${manifest.providerAbbr}) — ${manifest.providerId}`);

  // Refuse if the provider_id is already live.
  const existing = await pool.query('SELECT 1 FROM providers WHERE provider_id = $1', [manifest.providerId]);
  if (existing.rows.length) {
    console.error(
      `Conflict: providers.provider_id = ${manifest.providerId} already exists in the live DB. Revive refuses to overwrite. Delete or rename the live row first.`,
    );
    process.exit(3);
  }

  const proceed = await confirm(`\nRestore ${manifest.providerAbbr} (${manifest.providerId})? Type "yes" to proceed: `);
  if (!proceed) {
    console.error('Cancelled.');
    process.exit(0);
  }

  // Tournament files — one per file in tournaments/<id>.json
  const tournamentFiles = (await fs.readdir(path.join(archivePath, 'tournaments'))).filter((f) => f.endsWith('.json'));
  const tournaments = [];
  for (const f of tournamentFiles) {
    tournaments.push(await readJson(archivePath, path.join('tournaments', f)));
  }

  const data = {
    provider: await readJson(archivePath, 'provider.json'),
    user_providers: await readJson(archivePath, 'user_providers.json'),
    provisioner_providers: await readJson(archivePath, 'provisioner_providers.json'),
    tournament_assignments: await readJson(archivePath, 'tournament_assignments.json'),
    official_records: await readJson(archivePath, 'official_records.json'),
    sanctioning_records: await readJson(archivePath, 'sanctioning_records.json'),
    tournament_provisioner: await readJson(archivePath, 'tournament_provisioner.json'),
    pending_saves: await readJson(archivePath, 'pending_saves.json'),
    provider_topologies: await readJson(archivePath, 'provider_topologies.json'),
    provider_catalog_items: await readJson(archivePath, 'provider_catalog_items.json'),
    policies: await readJson(archivePath, 'policies.json'),
    calendars: await readJson(archivePath, 'calendar.json'),
    tournaments,
    audit_log: await readJsonl(archivePath, 'audit_log.jsonl'),
  };

  const client = await pool.connect();
  const restored = {};
  try {
    await client.query('BEGIN');

    // providers first — everything else FK-references it (soft or hard).
    restored.providers = await insertRows(client, 'providers', data.provider);
    // Then tournaments — audit_log references their tournament_id.
    restored.tournaments = await insertRows(client, 'tournaments', data.tournaments);
    // Then all the soft-FK tables (order among themselves doesn't matter).
    restored.user_providers = await insertRows(client, 'user_providers', data.user_providers);
    restored.provisioner_providers = await insertRows(client, 'provisioner_providers', data.provisioner_providers);
    restored.tournament_assignments = await insertRows(client, 'tournament_assignments', data.tournament_assignments);
    restored.official_records = await insertRows(client, 'official_records', data.official_records);
    restored.sanctioning_records = await insertRows(client, 'sanctioning_records', data.sanctioning_records);
    restored.tournament_provisioner = await insertRows(client, 'tournament_provisioner', data.tournament_provisioner);
    restored.pending_saves = await insertRows(client, 'pending_saves', data.pending_saves);
    restored.provider_topologies = await insertRows(client, 'provider_topologies', data.provider_topologies);
    restored.provider_catalog_items = await insertRows(client, 'provider_catalog_items', data.provider_catalog_items);
    restored.policies = await insertRows(client, 'policies', data.policies);
    restored.calendars = await insertRows(client, 'calendars', data.calendars);
    // audit_log last — its tournament_id FKs are conceptually present
    // even though the column has no FK constraint.
    restored.audit_log = await insertRows(client, 'audit_log', data.audit_log);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Restore transaction failed:', err.message);
    process.exit(4);
  } finally {
    client.release();
  }

  // Mark the provider_archives row revived if we can find it.
  await pool.query(
    `UPDATE provider_archives SET revived_at = NOW() WHERE provider_id = $1 AND archive_path = $2`,
    [manifest.providerId, archivePath],
  );

  console.error('\nRestored:');
  for (const [table, n] of Object.entries(restored)) {
    console.error(`  ${table}: ${n}`);
  }
  console.error('\nDone.');
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(4);
  });
