#!/usr/bin/env node
/**
 * Backfill `calendar_tournaments` (migration 047) from the legacy `calendars` blob.
 *
 * WHY THIS IS A DEPLOY STEP, NOT AN OPTIONAL CHORE
 *
 * 047 moved the calendar from one JSONB array per provider to one row per tournament, and
 * the read path switched with it. Until this runs, `calendar_tournaments` is empty and every
 * calendar — the TMX tournaments list, courthive-public's listing, the AMS dashboard — is
 * empty with it. The legacy `calendars.tournaments` column is deliberately left in place by
 * 047, so this is re-runnable and the cutover stays reversible.
 *
 * CA chose recompute-from-record (option b) over self-healing-on-next-save, because the
 * latter is on nobody's schedule. Two modes:
 *
 *   --from-blob     project each stored calendar ENTRY into a row. Fast, no factory, but
 *                   inherits whatever the blob holds.
 *   --recompute     load each tournament RECORD and rebuild the entry through the factory,
 *                   so derived fields are correct rather than merely copied. Slower.
 *                   THIS IS THE DEFAULT and the one CA chose.
 *
 * `--recompute` reads every tournament record. That is an all-records read, which
 * architectural standard A7 permits as an OFFLINE ADMIN JOB and never as a route. Run it off
 * the mutation primary (S6): point PG_* at a replica or a restored snapshot where possible.
 *
 *   node scripts/backfill-calendar-tournaments.mjs --dry
 *   node scripts/backfill-calendar-tournaments.mjs --apply
 *   node scripts/backfill-calendar-tournaments.mjs --apply --from-blob
 *   node scripts/backfill-calendar-tournaments.mjs --apply --provider BOCA
 *
 * Idempotent: rows are upserted on `tournament_id`, so re-running converges.
 *
 * ## Duplicates are REPORTED, never silently resolved
 *
 * "A tournament lives in exactly one calendar" was enforced only on FIRST APPEARANCE, by a
 * sweep that had to remember to run — and incident 2026-05-23 is the case where it did not.
 * So the same tournamentId may sit in two providers' blobs. `tournament_id` is the primary
 * key now, so one of them would silently win on upsert order.
 *
 * Instead every duplicate is collected and printed, and `--apply` REFUSES to run while any
 * exist unless `--resolve-duplicates` is passed, which keeps the copy whose provider matches
 * the tournament record's own `parentOrganisation` — the only defensible tie-break, and one
 * that still prints what it dropped.
 */

import { queryGovernor } from 'tods-competition-factory';
import pg from 'pg';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FROM_BLOB = args.includes('--from-blob');
const RESOLVE_DUPLICATES = args.includes('--resolve-duplicates');
const ONLY_PROVIDER = args.includes('--provider') ? args[args.indexOf('--provider') + 1] : undefined;

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

/** Mirrors `src/helpers/getCalendarEntry.ts` — the server-side stamps the factory omits. */
function buildEntry(tournamentRecord) {
  const entry = queryGovernor.getTournamentCalendarEntry({ tournamentRecord });
  const createdByUserId = (tournamentRecord.extensions ?? []).find((e) => e?.name === 'createdByUserId')?.value;
  let published = false;
  try {
    published = queryGovernor.getPublishState({ tournamentRecord })?.publishState?.tournament?.status?.published === true;
  } catch {
    // A malformed record must not take down the backfill; withhold rather than expose.
  }
  return { ...entry, createdByUserId, published };
}

async function loadProviders() {
  // Identity comes from the COLUMNS, not from `data`. `postgres-provider.storage.ts` spreads
  // `data` first and then overrides with the columns precisely because a stale
  // `data.organisationId` / `data.organisationAbbreviation` can shadow the canonical value —
  // and this backfill keys the whole calendar off exactly those two fields.
  const { rows } = await pool.query(
    'SELECT provider_id, organisation_abbreviation, organisation_name, data FROM providers',
  );
  const byAbbr = new Map();
  const byId = new Map();
  for (const row of rows) {
    const provider = {
      ...row.data,
      organisationId: row.provider_id,
      organisationAbbreviation: row.organisation_abbreviation,
      organisationName: row.organisation_name,
    };
    if (provider.organisationAbbreviation) byAbbr.set(provider.organisationAbbreviation, provider);
    byId.set(provider.organisationId, provider);
  }
  return { byAbbr, byId };
}

/**
 * Collect every (tournamentId -> provider) pairing the legacy blobs assert.
 * Returns the flat list plus the duplicates, which are a review gate rather than a warning.
 */
async function collectFromBlobs(providers) {
  const where = ONLY_PROVIDER ? 'WHERE provider_abbr = $1' : '';
  const params = ONLY_PROVIDER ? [ONLY_PROVIDER] : [];
  const { rows } = await pool.query(`SELECT provider_abbr, tournaments FROM calendars ${where}`, params);

  const claims = [];
  const unresolvedProviders = [];
  for (const row of rows) {
    const provider = providers.byAbbr.get(row.provider_abbr);
    if (!provider) {
      unresolvedProviders.push(row.provider_abbr);
      continue;
    }
    for (const entry of row.tournaments ?? []) {
      if (!entry?.tournamentId) continue;
      claims.push({ tournamentId: entry.tournamentId, provider, entry });
    }
  }

  const byTournament = new Map();
  for (const claim of claims) {
    if (!byTournament.has(claim.tournamentId)) byTournament.set(claim.tournamentId, []);
    byTournament.get(claim.tournamentId).push(claim);
  }
  const duplicates = [...byTournament.entries()].filter(([, list]) => list.length > 1);

  return { claims, byTournament, duplicates, unresolvedProviders };
}

/** Keep the copy whose provider matches the record's own parentOrganisation. */
async function resolveDuplicate(tournamentId, list) {
  const { rows } = await pool.query('SELECT data FROM tournaments WHERE tournament_id = $1', [tournamentId]);
  const ownerId = rows[0]?.data?.parentOrganisation?.organisationId;
  const winner = list.find((claim) => claim.provider.organisationId === ownerId);
  return { winner: winner ?? list[0], ownerId, arbitrary: !winner };
}

function toRowValues(entry, provider) {
  const t = entry.tournament ?? {};
  const identity = {};
  for (const key of [
    'formalName', 'promotionalName', 'tournamentLevel', 'tournamentRank', 'tournamentTier',
    'hostCountryCode', 'localTimeZone', 'activeDates', 'updatedAt', 'parentOrganisation',
  ]) {
    if (t[key] !== undefined) identity[key] = t[key];
  }

  const MAPPED = new Set([
    'tournamentId', 'tournamentName', 'startDate', 'endDate', 'tournamentStatus', 'tournamentImageURL',
    'eventInfo', 'onlineResources', 'venues', 'registrationProfile', 'tournamentContacts',
    'tournamentAddress', 'publishState', 'timeItemValues', 'notes', ...Object.keys(identity),
    'formalName', 'promotionalName', 'tournamentLevel', 'tournamentRank', 'tournamentTier',
    'hostCountryCode', 'localTimeZone', 'activeDates', 'updatedAt', 'parentOrganisation',
  ]);
  const remainder = {};
  for (const key of Object.keys(t)) if (!MAPPED.has(key) && t[key] !== undefined) remainder[key] = t[key];

  const dateOnly = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.split('T')[0] : null);
  const json = (v) => (v === undefined ? null : JSON.stringify(v));

  return [
    entry.tournamentId, provider.organisationId, provider.organisationAbbreviation ?? null,
    t.tournamentName ?? null, entry.searchText ?? (t.tournamentName ?? '').toLowerCase(),
    dateOnly(t.startDate), dateOnly(t.endDate), t.tournamentStatus ?? null, entry.published === true,
    Array.isArray(t.eventInfo) ? t.eventInfo.length : null, t.timeItemValues?.TMX?.offline ?? null,
    entry.createdByUserId ?? null, t.tournamentImageURL ?? null,
    json(identity), json(t.onlineResources), json(t.eventInfo), json(t.venues),
    json(t.registrationProfile), json(t.tournamentContacts), json(t.tournamentAddress),
    json(t.publishState), json(t.timeItemValues), t.notes ?? null, json(remainder),
  ];
}

const COLUMNS = [
  'tournament_id', 'provider_id', 'provider_abbr', 'tournament_name', 'search_text', 'start_date', 'end_date',
  'tournament_status', 'published', 'event_count', 'offline', 'created_by_user_id', 'tournament_image_url',
  'identity', 'online_resources', 'event_info', 'venues', 'registration_profile', 'tournament_contacts',
  'tournament_address', 'publish_state', 'time_items', 'notes', 'remainder',
];

async function upsert(values) {
  const placeholders = COLUMNS.map((_c, i) => `$${i + 1}`).join(', ');
  const updates = COLUMNS.filter((c) => c !== 'tournament_id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  await pool.query(
    `INSERT INTO calendar_tournaments (${COLUMNS.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (tournament_id) DO UPDATE SET ${updates}, row_updated_at = NOW()`,
    values,
  );
}

async function main() {
  const mode = FROM_BLOB ? 'from-blob' : 'recompute';
  console.log(`Mode: ${mode}${APPLY ? ' --apply' : ' (dry run)'}${ONLY_PROVIDER ? ` provider=${ONLY_PROVIDER}` : ''}\n`);

  const providers = await loadProviders();
  const { claims, byTournament, duplicates, unresolvedProviders } = await collectFromBlobs(providers);

  console.log(`calendars: ${byTournament.size} distinct tournaments across ${claims.length} calendar entries`);

  if (unresolvedProviders.length) {
    console.log(`\n⚠  ${unresolvedProviders.length} calendar(s) have no matching provider and were SKIPPED:`);
    for (const abbr of unresolvedProviders) console.log(`     ${abbr}`);
  }

  if (duplicates.length) {
    console.log(`\n⚠  ${duplicates.length} tournament(s) appear in MORE THAN ONE provider calendar.`);
    console.log('   The one-calendar invariant was enforced only on first appearance, so this is');
    console.log('   expected rather than impossible (incident 2026-05-23). tournament_id is the');
    console.log('   primary key now, so one copy would silently win.\n');
    for (const [tournamentId, list] of duplicates) {
      console.log(`     ${tournamentId}: ${list.map((c) => c.provider.organisationAbbreviation).join(', ')}`);
    }
    if (APPLY && !RESOLVE_DUPLICATES) {
      console.log('\n   REFUSING to apply. Re-run with --resolve-duplicates to keep the copy whose');
      console.log('   provider matches the record\'s own parentOrganisation (it prints what it drops).');
      await pool.end();
      process.exitCode = 1;
      return;
    }
  }

  let written = 0;
  let recomputed = 0;
  let missingRecords = 0;
  const arbitrary = [];
  const degraded = [];

  for (const [tournamentId, list] of byTournament) {
    let claim = list[0];
    if (list.length > 1) {
      const resolved = await resolveDuplicate(tournamentId, list);
      claim = resolved.winner;
      if (resolved.arbitrary) arbitrary.push(tournamentId);
      console.log(
        `   duplicate ${tournamentId}: keeping ${claim.provider.organisationAbbreviation}` +
          `${resolved.arbitrary ? ' (ARBITRARY — record names no owner)' : ''}`,
      );
    }

    let entry = claim.entry;
    if (!FROM_BLOB) {
      const { rows } = await pool.query('SELECT data FROM tournaments WHERE tournament_id = $1', [tournamentId]);
      const tournamentRecord = rows[0]?.data;
      if (tournamentRecord) {
        entry = buildEntry(tournamentRecord);
        recomputed += 1;
        // Recompute treats the RECORD as truth, so it can legitimately produce a thinner
        // entry than the blob held. Legitimate, but not something to discover in
        // production: if the blob knew a name and the rebuilt entry does not, the record is
        // damaged or the blob was written from something else. Report, do not paper over.
        const hadName = claim.entry?.tournament?.tournamentName;
        if (hadName && !entry?.tournament?.tournamentName) degraded.push(tournamentId);
      } else {
        // The blob lists a tournament that no longer exists. Carry the stored entry rather
        // than dropping the row silently; `calendarAudit` is the tool that reconciles these.
        missingRecords += 1;
      }
    }

    if (APPLY) await upsert(toRowValues(entry, claim.provider));
    written += 1;
  }

  console.log(`\n${APPLY ? 'Wrote' : 'Would write'} ${written} row(s).`);
  if (!FROM_BLOB) console.log(`  recomputed from record: ${recomputed}`);
  if (missingRecords) console.log(`  ⚠  ${missingRecords} listed tournament(s) have NO stored record (entry carried as-is)`);
  if (arbitrary.length) console.log(`  ⚠  ${arbitrary.length} duplicate(s) resolved ARBITRARILY — review: ${arbitrary.join(', ')}`);
  if (degraded.length) {
    console.log(`  ⚠  ${degraded.length} row(s) LOST a tournamentName the blob held — the stored record`);
    console.log(`     yields no name. Review before dropping calendars.tournaments: ${degraded.join(', ')}`);
  }

  if (APPLY) {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM calendar_tournaments');
    console.log(`\ncalendar_tournaments now holds ${rows[0].n} row(s).`);
  } else {
    console.log('\nDry run — nothing written. Pass --apply to write.');
  }

  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
