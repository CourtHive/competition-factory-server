#!/usr/bin/env node
/**
 * Backfill the `published` flag onto every provider-calendar entry.
 *
 * WHY THIS IS A DEPLOY STEP, NOT AN OPTIONAL CHORE
 *
 * `POST /provider/calendar` (unauthenticated) now lists only entries with
 * `published === true`. That flag is stamped at write time by `getCalendarEntry()`,
 * so it exists only on entries written since that change. The read path uses strict
 * equality — a missing flag withholds — because the alternative is fail-open, which
 * is the shape that produced the original defect.
 *
 * The consequence: until this runs, every calendar written earlier lists NOTHING
 * publicly. courthive-public's tournament list goes empty for those providers.
 * Entries do self-heal on the tournament's next save, but that is not a schedule
 * anyone controls.
 *
 * Run after deploying, before announcing.
 *
 *   node scripts/backfill-calendar-published.mjs --dry
 *   node scripts/backfill-calendar-published.mjs --apply
 *   node scripts/backfill-calendar-published.mjs --apply --provider BOCA
 *
 * Idempotent: re-running re-derives the same flag from the same records.
 */

import { queryGovernor } from 'tods-competition-factory';
import pg from 'pg';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY = args.includes('--dry') || !APPLY;
const providerArg = args[args.indexOf('--provider') + 1];
const ONLY_PROVIDER = args.includes('--provider') ? providerArg : undefined;

if (!APPLY && !args.includes('--dry')) {
  console.log('No mode given — defaulting to --dry. Pass --apply to write.\n');
}

const pool = new pg.Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

function isPublished(tournamentRecord) {
  try {
    const { publishState } = queryGovernor.getPublishState({ tournamentRecord }) ?? {};
    return publishState?.tournament?.status?.published === true;
  } catch {
    return false;
  }
}

async function main() {
  // Schema verified against src/storage/postgres/postgres-calendar.storage.ts:
  // `calendars` stores provider and tournaments as SEPARATE jsonb columns, not one blob.
  const { rows: calendars } = await pool.query(
    ONLY_PROVIDER
      ? 'SELECT provider_abbr, tournaments FROM calendars WHERE provider_abbr = $1'
      : 'SELECT provider_abbr, tournaments FROM calendars',
    ONLY_PROVIDER ? [ONLY_PROVIDER] : [],
  );

  if (!calendars.length) {
    console.error('No calendars found. Check PG_* env vars and the table name.');
    process.exitCode = 1;
    return;
  }

  const totals = { calendars: 0, entries: 0, published: 0, unpublished: 0, missingRecord: 0, changed: 0 };

  for (const { provider_abbr: abbr, tournaments: stored } of calendars) {
    const tournaments = (typeof stored === 'string' ? JSON.parse(stored) : stored) ?? [];
    if (!tournaments.length) continue;

    totals.calendars += 1;
    let changedHere = 0;

    for (const entry of tournaments) {
      totals.entries += 1;

      const { rows } = await pool.query('SELECT data FROM tournaments WHERE tournament_id = $1 LIMIT 1', [
        entry.tournamentId,
      ]);
      if (!rows.length) {
        // In the calendar, absent from storage. `calendarAudit` already reports these.
        // Leave the flag off: we cannot establish publish state, and withholding is correct.
        totals.missingRecord += 1;
        if (entry.published !== false) {
          entry.published = false;
          changedHere += 1;
        }
        continue;
      }

      const record = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
      const published = isPublished(record);
      published ? (totals.published += 1) : (totals.unpublished += 1);

      if (entry.published !== published) {
        entry.published = published;
        changedHere += 1;
      }
    }

    totals.changed += changedHere;
    console.log(
      `${abbr.padEnd(12)} ${String(tournaments.length).padStart(6)} entries  ${String(changedHere).padStart(6)} to stamp`,
    );

    if (APPLY && changedHere) {
      await pool.query('UPDATE calendars SET tournaments = $2, updated_at = NOW() WHERE provider_abbr = $1', [
        abbr,
        JSON.stringify(tournaments),
      ]);
    }
  }

  console.log(
    `\n${DRY ? 'DRY RUN — nothing written' : 'APPLIED'}\n` +
      `  calendars      ${totals.calendars}\n` +
      `  entries        ${totals.entries}\n` +
      `  published      ${totals.published}\n` +
      `  unpublished    ${totals.unpublished}\n` +
      `  no record      ${totals.missingRecord}\n` +
      `  stamped        ${totals.changed}`,
  );

  if (DRY && totals.published === 0 && totals.entries > 0) {
    console.warn(
      '\n⚠️  Every entry resolved to unpublished. That is possible, but it is also what a broken\n' +
        '    publish-state read looks like. Verify one known-published tournament before --apply.',
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
