#!/usr/bin/env node
/**
 * audit-demo-tournaments.mjs — classify every row in the tournaments
 * table as confirmed-demo / suspected-demo / real, and print a CSV
 * report. Optional --delete-confirmed flag deletes the
 * `classification = confirmed` rows after the operator has reviewed
 * the report.
 *
 * `isMock` (on the tournamentRecord JSONB blob) is the authoritative
 * marker: mocksEngine stamps it on every generated record, so anything
 * with `data.isMock === true` is definitionally a demo tournament.
 * Beyond that, the script flags rows whose tournamentId matches the
 * mocksEngine's typical id shape ("mock-*", UUID-only) or whose name
 * looks demo-shaped ("test", "demo", "sample", "mock") as SUSPECTED
 * so a human can eyeball them.
 *
 * Why a standalone script and not an endpoint: this is a one-shot
 * cleanup tool. The Plan A archive/delete endpoints handle the live
 * provider-lifecycle case; this audits historical accidental demos
 * so the user can clean before archiving the providers that own them.
 *
 * Usage:
 *   node src/scripts/audit-demo-tournaments.mjs                       # CSV to stdout
 *   node src/scripts/audit-demo-tournaments.mjs > demos.csv           # save
 *   node src/scripts/audit-demo-tournaments.mjs --confirmed-only      # only isMock=true rows
 *   node src/scripts/audit-demo-tournaments.mjs --provider <id>       # filter by provider
 *   node src/scripts/audit-demo-tournaments.mjs --delete-confirmed    # DESTRUCTIVE: deletes confirmed rows
 *
 * Exit codes:
 *   0  success
 *   1  configuration error (no DB connection)
 *   2  runtime error
 */

import minimist from 'minimist';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const args = minimist(process.argv.slice(2), {
  boolean: ['confirmed-only', 'delete-confirmed', 'help'],
  string: ['provider'],
  alias: { h: 'help', p: 'provider' },
});

if (args.help) {
  console.error(`Usage: node src/scripts/audit-demo-tournaments.mjs [flags]
  --confirmed-only       Only emit rows where tournamentRecord.isMock === true
  --provider <id>        Filter by providerId
  --delete-confirmed     After printing, DELETE all confirmed-demo rows
  -h, --help             Show this`);
  process.exit(0);
}

const pool = new Pool({
  host:     process.env.PG_HOST,
  port:     process.env.PG_PORT ? Number(process.env.PG_PORT) : undefined,
  user:     process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

// Patterns the script treats as SUSPECTED-demo. Conservative: a real
// tournament named "Bristol Test Trophy" should NOT be flagged, so the
// regex looks for word-boundary matches on tokens that are unambiguously
// internal-use language. The operator reads the CSV and decides.
const NAME_PATTERNS = [
  /\b(demo|sample|mock|playground|sandbox)\b/i,
  /^test\b/i,
  /\btest\s+(event|tournament|draw)\b/i,
];

const ID_PATTERNS = [
  /^mock-/i,                 // mocksEngine sometimes prefixes
  /^demo-/i,
  /^test-/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // bare UUID (factory test pattern)
];

function classify(row) {
  const record = row.data ?? {};
  if (record.isMock === true) return 'confirmed';
  const id = String(row.tournament_id ?? '');
  const name = String(row.tournament_name ?? record.tournamentName ?? '');
  if (ID_PATTERNS.some((p) => p.test(id))) return 'suspected';
  if (NAME_PATTERNS.some((p) => p.test(name))) return 'suspected';
  return 'real';
}

function countEvents(record) {
  return Array.isArray(record?.events) ? record.events.length : 0;
}

function countMatchUps(record) {
  let total = 0;
  for (const event of record?.events ?? []) {
    for (const flight of event?.drawDefinitions ?? []) {
      for (const structure of flight?.structures ?? []) {
        total += Array.isArray(structure?.matchUps) ? structure.matchUps.length : 0;
      }
    }
  }
  return total;
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replaceAll('"', '""') + '"';
  }
  return s;
}

async function main() {
  let where = '';
  const params = [];
  if (args.provider) {
    params.push(args.provider);
    where = `WHERE provider_id = $${params.length}`;
  }

  const sql = `
    SELECT t.tournament_id,
           t.provider_id,
           t.tournament_name,
           t.updated_at,
           t.data,
           p.organisation_abbreviation AS provider_abbr
      FROM tournaments t
      LEFT JOIN providers p ON p.provider_id = t.provider_id
      ${where}
  `;

  const result = await pool.query(sql, params);

  const rows = result.rows.map((row) => {
    const record = row.data ?? {};
    return {
      tournament_id:   row.tournament_id,
      provider_id:     row.provider_id ?? '',
      provider_abbr:   row.provider_abbr ?? '',
      name:            row.tournament_name ?? record.tournamentName ?? '',
      classification:  classify(row),
      last_modified:   row.updated_at?.toISOString?.() ?? '',
      event_count:     countEvents(record),
      matchup_count:   countMatchUps(record),
    };
  });

  const filtered = args['confirmed-only']
    ? rows.filter((r) => r.classification === 'confirmed')
    : rows;

  // Print CSV header + rows. Stable order: classification (confirmed first), then provider_abbr, then name.
  const order = { confirmed: 0, suspected: 1, real: 2 };
  filtered.sort((a, b) =>
    order[a.classification] - order[b.classification] ||
    a.provider_abbr.localeCompare(b.provider_abbr) ||
    a.name.localeCompare(b.name),
  );

  const header = 'tournament_id,provider_id,provider_abbr,name,classification,last_modified,event_count,matchup_count';
  console.log(header);
  for (const r of filtered) {
    console.log([
      csvEscape(r.tournament_id),
      csvEscape(r.provider_id),
      csvEscape(r.provider_abbr),
      csvEscape(r.name),
      csvEscape(r.classification),
      csvEscape(r.last_modified),
      csvEscape(r.event_count),
      csvEscape(r.matchup_count),
    ].join(','));
  }

  // Summary to stderr so CSV-to-file usage doesn't get polluted.
  const counts = { confirmed: 0, suspected: 0, real: 0 };
  for (const r of rows) counts[r.classification]++;
  console.error(
    `\nSummary: ${rows.length} total | confirmed: ${counts.confirmed} | suspected: ${counts.suspected} | real: ${counts.real}`,
  );

  if (args['delete-confirmed']) {
    const ids = rows.filter((r) => r.classification === 'confirmed').map((r) => r.tournament_id);
    if (ids.length === 0) {
      console.error('--delete-confirmed: no confirmed rows to delete');
    } else {
      console.error(`\n--delete-confirmed: deleting ${ids.length} confirmed-demo tournaments…`);
      const del = await pool.query(`DELETE FROM tournaments WHERE tournament_id = ANY($1::text[])`, [ids]);
      console.error(`deleted ${del.rowCount} row(s) from tournaments`);
      // Note: this does NOT clean associated assignments, audit_log, or
      // calendars — those are handled by the Plan A provider archive/delete
      // path when the OWNING PROVIDER is archived. If you're using this
      // standalone delete, run the audit again afterwards to confirm.
    }
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(2);
  });
