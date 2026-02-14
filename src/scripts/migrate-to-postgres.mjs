/**
 * LevelDB → PostgreSQL Migration Script
 *
 * Reads all data from LevelDB and inserts it into PostgreSQL.
 * Safe to run multiple times — uses INSERT ... ON CONFLICT DO UPDATE.
 *
 * Prerequisites:
 *   1. PostgreSQL database created (see STORAGE_PROVIDER docs)
 *   2. Schema applied:  psql -d courthive -f src/storage/postgres/migrations/001-initial-schema.sql
 *   3. LevelDB server running (net-level-server)
 *   4. .env file configured with both DB_* (LevelDB) and PG_* (PostgreSQL) vars
 *
 * Usage:
 *   node src/scripts/migrate-to-postgres.mjs [--dry-run] [--verbose]
 *
 * Options:
 *   --dry-run   Read from LevelDB and report counts without writing to PostgreSQL
 *   --verbose   Print each record as it's migrated
 */

import netLevel from './netLevel.mjs';
import minimist from 'minimist';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const rawArgs = process.argv.slice(2).filter((arg) => arg !== '--');
const args = minimist(rawArgs, {
  default: { 'dry-run': false, verbose: false },
  boolean: ['dry-run', 'verbose'],
  alias: { d: 'dry-run', v: 'verbose' },
});

const dryRun = args['dry-run'];
const verbose = args.verbose;

// --- LevelDB base names (must match src/services/levelDB/constants.ts) ---
const BASE_TOURNAMENT = 'tournamentRecord';
const BASE_CALENDAR = 'calendar';
const BASE_PROVIDER = 'provider';
const BASE_USER = 'user';
const BASE_ACCESS_CODES = 'accessCodes';
const BASE_RESET_CODES = 'resetCodes';

// --- PostgreSQL connection ---
function createPool() {
  return new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT) || 5432,
    user: process.env.PG_USER || 'courthive',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'courthive',
  });
}

// --- Helpers ---
function log(...args) {
  if (verbose) console.log(...args);
}

function logSection(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

// --- Migration functions ---

async function migrateTournaments(pool) {
  logSection('Tournaments');
  let records;
  try {
    records = await netLevel.list(BASE_TOURNAMENT, { all: true });
  } catch (err) {
    console.log('  No tournament records found or LevelDB error:', err.message);
    return 0;
  }
  if (!records?.length) {
    console.log('  No tournament records found');
    return 0;
  }

  console.log(`  Found ${records.length} tournament(s) in LevelDB`);
  let migrated = 0;

  for (const record of records) {
    const tournamentRecord = record.value;
    const tournamentId = record.key || tournamentRecord?.tournamentId;
    if (!tournamentId) continue;

    const providerId = tournamentRecord?.parentOrganisation?.organisationId ?? null;
    const tournamentName = tournamentRecord?.tournamentName ?? null;
    const startDate = tournamentRecord?.startDate ?? null;
    const endDate = tournamentRecord?.endDate ?? null;

    log(`  -> ${tournamentId}: ${tournamentName || '(unnamed)'}`);

    if (!dryRun) {
      await pool.query(
        `INSERT INTO tournaments (tournament_id, provider_id, tournament_name, start_date, end_date, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (tournament_id) DO UPDATE SET
           provider_id = EXCLUDED.provider_id,
           tournament_name = EXCLUDED.tournament_name,
           start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date,
           data = EXCLUDED.data,
           updated_at = NOW()`,
        [tournamentId, providerId, tournamentName, startDate, endDate, JSON.stringify(tournamentRecord)],
      );
    }
    migrated++;
  }

  console.log(`  ${dryRun ? 'Would migrate' : 'Migrated'}: ${migrated} tournament(s)`);
  return migrated;
}

async function migrateUsers(pool) {
  logSection('Users');
  let records;
  try {
    records = await netLevel.list(BASE_USER, { all: true });
  } catch (err) {
    console.log('  No user records found or LevelDB error:', err.message);
    return 0;
  }
  if (!records?.length) {
    console.log('  No user records found');
    return 0;
  }

  console.log(`  Found ${records.length} user(s) in LevelDB`);
  let migrated = 0;

  for (const record of records) {
    const user = record.value;
    const email = record.key || user?.email;
    if (!email) continue;

    const { password, providerId, roles = [], permissions = [], ...rest } = user;

    log(`  -> ${email} (roles: ${JSON.stringify(roles)})`);

    if (!dryRun) {
      await pool.query(
        `INSERT INTO users (email, password, provider_id, roles, permissions, data, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (email) DO UPDATE SET
           password = EXCLUDED.password,
           provider_id = EXCLUDED.provider_id,
           roles = EXCLUDED.roles,
           permissions = EXCLUDED.permissions,
           data = EXCLUDED.data,
           updated_at = NOW()`,
        [email, password || '', providerId ?? null, JSON.stringify(roles), JSON.stringify(permissions), JSON.stringify(rest)],
      );
    }
    migrated++;
  }

  console.log(`  ${dryRun ? 'Would migrate' : 'Migrated'}: ${migrated} user(s)`);
  return migrated;
}

async function migrateProviders(pool) {
  logSection('Providers');
  let records;
  try {
    records = await netLevel.list(BASE_PROVIDER, { all: true });
  } catch (err) {
    console.log('  No provider records found or LevelDB error:', err.message);
    return 0;
  }
  if (!records?.length) {
    console.log('  No provider records found');
    return 0;
  }

  console.log(`  Found ${records.length} provider(s) in LevelDB`);
  let migrated = 0;

  for (const record of records) {
    const provider = record.value;
    const providerId = record.key || provider?.organisationId;
    if (!providerId) continue;

    const { organisationAbbreviation, organisationName, organisationId, ...rest } = provider;

    log(`  -> ${providerId}: ${organisationAbbreviation || organisationName || '(unnamed)'}`);

    if (!dryRun) {
      await pool.query(
        `INSERT INTO providers (provider_id, organisation_abbreviation, organisation_name, data, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (provider_id) DO UPDATE SET
           organisation_abbreviation = EXCLUDED.organisation_abbreviation,
           organisation_name = EXCLUDED.organisation_name,
           data = EXCLUDED.data,
           updated_at = NOW()`,
        [providerId, organisationAbbreviation || '', organisationName ?? null, JSON.stringify(rest)],
      );
    }
    migrated++;
  }

  console.log(`  ${dryRun ? 'Would migrate' : 'Migrated'}: ${migrated} provider(s)`);
  return migrated;
}

async function migrateCalendars(pool) {
  logSection('Calendars');
  let records;
  try {
    records = await netLevel.list(BASE_CALENDAR, { all: true });
  } catch (err) {
    console.log('  No calendar records found or LevelDB error:', err.message);
    return 0;
  }
  if (!records?.length) {
    console.log('  No calendar records found');
    return 0;
  }

  console.log(`  Found ${records.length} calendar(s) in LevelDB`);
  let migrated = 0;

  for (const record of records) {
    const calendar = record.value;
    const providerAbbr = record.key;
    if (!providerAbbr) continue;

    const tournamentCount = calendar?.tournaments?.length ?? 0;
    log(`  -> ${providerAbbr}: ${tournamentCount} tournament(s)`);

    if (!dryRun) {
      await pool.query(
        `INSERT INTO calendars (provider_abbr, provider, tournaments, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (provider_abbr) DO UPDATE SET
           provider = EXCLUDED.provider,
           tournaments = EXCLUDED.tournaments,
           updated_at = NOW()`,
        [providerAbbr, JSON.stringify(calendar?.provider ?? null), JSON.stringify(calendar?.tournaments ?? [])],
      );
    }
    migrated++;
  }

  console.log(`  ${dryRun ? 'Would migrate' : 'Migrated'}: ${migrated} calendar(s)`);
  return migrated;
}

async function migrateResetCodes(pool) {
  logSection('Reset Codes');
  let records;
  try {
    records = await netLevel.list(BASE_RESET_CODES, { all: true });
  } catch (err) {
    console.log('  No reset code records found or LevelDB error:', err.message);
    return 0;
  }
  if (!records?.length) {
    console.log('  No reset code records found');
    return 0;
  }

  console.log(`  Found ${records.length} reset code(s) in LevelDB`);
  let migrated = 0;

  for (const record of records) {
    const code = record.key;
    const email = typeof record.value === 'string' ? record.value : record.value?.email;
    if (!code || !email) continue;

    log(`  -> code ${code}: ${email}`);

    if (!dryRun) {
      await pool.query(
        `INSERT INTO reset_codes (code, email) VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET email = EXCLUDED.email`,
        [code, email],
      );
    }
    migrated++;
  }

  console.log(`  ${dryRun ? 'Would migrate' : 'Migrated'}: ${migrated} reset code(s)`);
  return migrated;
}

async function migrateAccessCodes(pool) {
  logSection('Access Codes');
  let records;
  try {
    records = await netLevel.list(BASE_ACCESS_CODES, { all: true });
  } catch (err) {
    console.log('  No access code records found or LevelDB error:', err.message);
    return 0;
  }
  if (!records?.length) {
    console.log('  No access code records found');
    return 0;
  }

  console.log(`  Found ${records.length} access code(s) in LevelDB`);
  let migrated = 0;

  for (const record of records) {
    const code = record.key;
    const email = typeof record.value === 'string' ? record.value : record.value?.email;
    if (!code || !email) continue;

    log(`  -> code ${code}: ${email}`);

    if (!dryRun) {
      await pool.query(
        `INSERT INTO access_codes (code, email) VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET email = EXCLUDED.email`,
        [code, email],
      );
    }
    migrated++;
  }

  console.log(`  ${dryRun ? 'Would migrate' : 'Migrated'}: ${migrated} access code(s)`);
  return migrated;
}

// --- Main ---

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          LevelDB → PostgreSQL Migration Tool           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  if (dryRun) {
    console.log('\n  *** DRY RUN MODE — no data will be written ***\n');
  }

  console.log('LevelDB:    %s:%s', process.env.DB_HOST || 'localhost', process.env.DB_PORT || '3838');
  console.log('PostgreSQL: %s:%s/%s',
    process.env.PG_HOST || 'localhost',
    process.env.PG_PORT || '5432',
    process.env.PG_DATABASE || 'courthive',
  );

  let pool;
  if (!dryRun) {
    pool = createPool();
    // Verify connection
    try {
      await pool.query('SELECT 1');
      console.log('PostgreSQL: connected');
    } catch (err) {
      console.error('\nFailed to connect to PostgreSQL:', err.message);
      console.error('Make sure the database exists and PG_* env vars are set in .env');
      process.exit(1);
    }
  }

  const totals = {};

  try {
    totals.tournaments = await migrateTournaments(pool);
    totals.users = await migrateUsers(pool);
    totals.providers = await migrateProviders(pool);
    totals.calendars = await migrateCalendars(pool);
    totals.resetCodes = await migrateResetCodes(pool);
    totals.accessCodes = await migrateAccessCodes(pool);
  } catch (err) {
    console.error('\nMigration failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }

  logSection('Summary');
  for (const [entity, count] of Object.entries(totals)) {
    console.log(`  ${entity}: ${count}`);
  }
  const total = Object.values(totals).reduce((sum, n) => sum + n, 0);
  console.log(`\n  Total records ${dryRun ? 'found' : 'migrated'}: ${total}`);

  if (dryRun) {
    console.log('\n  To perform the actual migration, run without --dry-run');
  } else {
    console.log('\n  Migration complete!');
    console.log('  You can now set STORAGE_PROVIDER=postgres in .env and restart the server.');
  }

  // Cleanup
  try {
    await netLevel.exit();
  } catch {
    // ignore close errors
  }
  if (pool) {
    await pool.end();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
