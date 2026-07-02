#!/usr/bin/env node
/**
 * audit-tournament-records.cjs
 *
 * Read-only audit of every tournamentRecord in the Postgres `tournaments` table across all
 * providers. Runs each draw through the factory's getStructureInconsistencies (what's WRONG
 * in the decided state) and getStructureCompleteness (what's still MISSING) and emits a
 * markdown report with per-provider aggregated stats.
 *
 * Both engine methods are called statelessly with { drawDefinition } — no setState, no writes.
 *
 * Usage:
 *   node scripts/audit-tournament-records.cjs [--out report.md] [--limit N] [--self-test]
 *
 * Env (for the live DB pass): PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE
 *   (source competition-factory-server/shared/.env first)
 */
const fs = require('fs');
const path = require('path');
const factory = require('tods-competition-factory');
const { drawsGovernor } = factory;

const ISSUE_ORDER = [
  'WINNING_SIDE_WITHOUT_PARTICIPANT',
  'WINNING_SIDE_ADVANCEMENT_MISMATCH',
  'DRAW_POSITION_UNASSIGNED',
  'DRAW_POSITIONS_NOT_SORTED',
  'EXIT_CODE_ON_WINNER_SIDE',
  'EXIT_WITHOUT_LOSER',
  'ENGINE_ERROR',
];

function emptyProvider(providerId, providerName) {
  return {
    providerId: providerId || 'UNASSIGNED',
    providerName: providerName || providerId || 'UNASSIGNED',
    tournaments: new Set(),
    events: 0,
    draws: 0,
    drawsWithInconsistencies: 0,
    drawsIncomplete: 0,
    drawsCleanAndComplete: 0,
    inconsistencyTotal: 0,
    issueTypes: {},
    unassignedPositions: 0,
    unplayedMatchUps: 0,
    engineErrors: 0,
    worstDraws: [], // { tournamentId, tournamentName, drawName, issueCount, issueTypes }
  };
}

function bump(map, key, n = 1) {
  map[key] = (map[key] || 0) + n;
}

// analyze a list of rows: [{ tournamentId, providerId, data }] -> aggregated model
function analyzeRecords(rows) {
  const providers = new Map();
  const globalIssueTypes = {};
  const totals = {
    providers: 0,
    tournaments: 0,
    events: 0,
    draws: 0,
    drawsWithInconsistencies: 0,
    drawsIncomplete: 0,
    drawsCleanAndComplete: 0,
    inconsistencyTotal: 0,
    unassignedPositions: 0,
    unplayedMatchUps: 0,
    engineErrors: 0,
    recordsFailed: 0,
  };
  const allWorst = [];

  for (const row of rows) {
    const record = typeof row.data === 'string' ? safeParse(row.data) : row.data;
    if (!record) {
      totals.recordsFailed += 1;
      continue;
    }
    const org = record.parentOrganisation || {};
    const providerId = row.providerId || org.organisationId || 'UNASSIGNED';
    const providerName = org.organisationName || org.organisationAbbreviation || providerId;
    if (!providers.has(providerId)) providers.set(providerId, emptyProvider(providerId, providerName));
    const agg = providers.get(providerId);
    agg.tournaments.add(row.tournamentId || record.tournamentId);
    totals.tournaments += 1;

    const events = Array.isArray(record.events) ? record.events : [];
    for (const event of events) {
      agg.events += 1;
      totals.events += 1;
      const draws = Array.isArray(event.drawDefinitions) ? event.drawDefinitions : [];
      for (const drawDefinition of draws) {
        agg.draws += 1;
        totals.draws += 1;
        analyzeDraw({
          drawDefinition,
          event,
          record,
          row,
          agg,
          totals,
          globalIssueTypes,
          allWorst,
        });
      }
    }
  }

  totals.providers = providers.size;
  return { providers, totals, globalIssueTypes, allWorst };
}

function analyzeDraw(ctx) {
  const { drawDefinition, event, record, row, agg, totals, globalIssueTypes, allWorst } = ctx;
  let issueTypes = [];
  let incomplete = false;
  let unassigned = 0;
  let unplayed = 0;

  try {
    const inc = drawsGovernor.getStructureInconsistencies({ drawDefinition });
    const inconsistencies = (inc && inc.inconsistencies) || [];
    issueTypes = inconsistencies.map((i) => i.issueType);
  } catch (err) {
    issueTypes = ['ENGINE_ERROR'];
    agg.engineErrors += 1;
    totals.engineErrors += 1;
  }

  try {
    const comp = drawsGovernor.getStructureCompleteness({ drawDefinition });
    if (comp && comp.completeness) {
      unassigned = comp.completeness.unassignedPositionCount || 0;
      unplayed = comp.completeness.unplayedMatchUpCount || 0;
      incomplete = comp.complete === false;
    }
  } catch (err) {
    // completeness failure is itself a signal; count as engine error if not already
    if (!issueTypes.includes('ENGINE_ERROR')) {
      issueTypes = issueTypes.concat('ENGINE_ERROR');
      agg.engineErrors += 1;
      totals.engineErrors += 1;
    }
  }

  const issueCount = issueTypes.length;
  for (const t of issueTypes) {
    bump(agg.issueTypes, t);
    bump(globalIssueTypes, t);
  }
  agg.inconsistencyTotal += issueCount;
  totals.inconsistencyTotal += issueCount;

  if (issueCount) {
    agg.drawsWithInconsistencies += 1;
    totals.drawsWithInconsistencies += 1;
    allWorst.push({
      providerName: agg.providerName,
      tournamentId: row.tournamentId || record.tournamentId,
      tournamentName: record.tournamentName || row.tournamentId,
      eventName: event.eventName || event.eventId,
      drawName: drawDefinition.drawName || drawDefinition.drawId,
      drawType: drawDefinition.drawType || '',
      issueCount,
      issueTypes: countBy(issueTypes),
    });
  }
  if (incomplete) {
    agg.drawsIncomplete += 1;
    totals.drawsIncomplete += 1;
  }
  agg.unassignedPositions += unassigned;
  agg.unplayedMatchUps += unplayed;
  totals.unassignedPositions += unassigned;
  totals.unplayedMatchUps += unplayed;

  if (!issueCount && !incomplete) {
    agg.drawsCleanAndComplete += 1;
    totals.drawsCleanAndComplete += 1;
  }
}

function countBy(arr) {
  const m = {};
  for (const x of arr) bump(m, x);
  return m;
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function pct(n, d) {
  if (!d) return '—';
  return `${((100 * n) / d).toFixed(1)}%`;
}

// -------- markdown report --------
function renderReport({ providers, totals, globalIssueTypes, allWorst }, meta) {
  const lines = [];
  lines.push(`# Tournament Records — Structure Audit`);
  lines.push('');
  lines.push(`Generated: ${meta.generatedAt}`);
  lines.push('');
  lines.push(`Source: \`${meta.database}\` · table \`tournaments\` · scope: all providers${meta.limit ? ` (limited to ${meta.limit})` : ''}`);
  lines.push('');
  lines.push(`Factory: getStructureInconsistencies (correctness) + getStructureCompleteness (readiness), run per draw.`);
  lines.push('');

  lines.push(`## Executive summary`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Providers | ${totals.providers} |`);
  lines.push(`| Tournaments | ${totals.tournaments} |`);
  lines.push(`| Events | ${totals.events} |`);
  lines.push(`| Draws | ${totals.draws} |`);
  lines.push(`| Draws with inconsistencies | ${totals.drawsWithInconsistencies} (${pct(totals.drawsWithInconsistencies, totals.draws)}) |`);
  lines.push(`| Incomplete draws | ${totals.drawsIncomplete} (${pct(totals.drawsIncomplete, totals.draws)}) |`);
  lines.push(`| Clean AND complete draws | ${totals.drawsCleanAndComplete} (${pct(totals.drawsCleanAndComplete, totals.draws)}) |`);
  lines.push(`| Total inconsistencies flagged | ${totals.inconsistencyTotal} |`);
  lines.push(`| Total unassigned positions | ${totals.unassignedPositions} |`);
  lines.push(`| Total unplayed matchUps | ${totals.unplayedMatchUps} |`);
  lines.push(`| Draws raising engine errors | ${totals.engineErrors} |`);
  lines.push(`| Records that failed to parse | ${totals.recordsFailed} |`);
  lines.push('');

  lines.push(`## Inconsistency breakdown (ecosystem-wide)`);
  lines.push('');
  lines.push(`| issueType | occurrences |`);
  lines.push(`| --- | --- |`);
  const seen = new Set();
  for (const t of ISSUE_ORDER) {
    if (globalIssueTypes[t]) {
      lines.push(`| ${t} | ${globalIssueTypes[t]} |`);
      seen.add(t);
    }
  }
  for (const [t, n] of Object.entries(globalIssueTypes)) {
    if (!seen.has(t)) lines.push(`| ${t} | ${n} |`);
  }
  if (!Object.keys(globalIssueTypes).length) lines.push(`| (none) | 0 |`);
  lines.push('');

  lines.push(`## Per-provider`);
  lines.push('');
  lines.push(`| Provider | Tourns | Draws | Draws w/ issues | Incomplete | Clean+Complete | Unassigned | Unplayed | Engine errs |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  const provArr = [...providers.values()].sort(
    (a, b) => b.drawsWithInconsistencies - a.drawsWithInconsistencies || b.draws - a.draws,
  );
  for (const p of provArr) {
    lines.push(
      `| ${p.providerName} | ${p.tournaments.size} | ${p.draws} | ${p.drawsWithInconsistencies} (${pct(p.drawsWithInconsistencies, p.draws)}) | ${p.drawsIncomplete} | ${p.drawsCleanAndComplete} (${pct(p.drawsCleanAndComplete, p.draws)}) | ${p.unassignedPositions} | ${p.unplayedMatchUps} | ${p.engineErrors} |`,
    );
  }
  lines.push('');

  // per-provider issueType detail (only providers with any issues)
  const withIssues = provArr.filter((p) => p.inconsistencyTotal > 0);
  if (withIssues.length) {
    lines.push(`## Per-provider inconsistency types`);
    lines.push('');
    for (const p of withIssues) {
      const parts = Object.entries(p.issueTypes)
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${t}: ${n}`);
      lines.push(`- **${p.providerName}** — ${parts.join(' · ')}`);
    }
    lines.push('');
  }

  // top offending draws
  const worst = allWorst.sort((a, b) => b.issueCount - a.issueCount).slice(0, 30);
  if (worst.length) {
    lines.push(`## Top draws by inconsistency count (max 30)`);
    lines.push('');
    lines.push(`| Provider | Tournament | Event | Draw | Type | Issues |`);
    lines.push(`| --- | --- | --- | --- | --- | --- |`);
    for (const w of worst) {
      const types = Object.entries(w.issueTypes)
        .map(([t, n]) => `${t}×${n}`)
        .join(', ');
      lines.push(
        `| ${w.providerName} | ${trunc(w.tournamentName)} | ${trunc(w.eventName)} | ${trunc(w.drawName)} | ${w.drawType} | ${types} |`,
      );
    }
    lines.push('');
    if (allWorst.length > worst.length) {
      lines.push(`_+${allWorst.length - worst.length} more draws with inconsistencies not shown._`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function trunc(s, n = 40) {
  s = String(s == null ? '' : s).replace(/\|/g, '\\|');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// -------- self-test (local, no DB) --------
async function selfTest() {
  const { mocksEngine, tournamentEngine } = factory;
  const rows = [];
  // clean completed draw
  const a = mocksEngine.generateTournamentRecord({
    drawProfiles: [{ drawId: 'clean', drawSize: 16, drawType: 'SINGLE_ELIMINATION' }],
    completeAllMatchUps: true,
  });
  a.tournamentRecord.parentOrganisation = { organisationId: 'prov-A', organisationName: 'Provider A' };
  rows.push({ tournamentId: a.tournamentRecord.tournamentId, providerId: 'prov-A', data: a.tournamentRecord });
  // in-progress draw (incomplete, not inconsistent)
  const b = mocksEngine.generateTournamentRecord({
    drawProfiles: [{ drawId: 'wip', drawSize: 8, drawType: 'SINGLE_ELIMINATION' }],
  });
  b.tournamentRecord.parentOrganisation = { organisationId: 'prov-B', organisationName: 'Provider B' };
  rows.push({ tournamentId: b.tournamentRecord.tournamentId, providerId: 'prov-B', data: b.tournamentRecord });
  // corrupted draw (inject an inconsistency): flip a winningSide
  const c = mocksEngine.generateTournamentRecord({
    drawProfiles: [{ drawId: 'bad', drawSize: 8, drawType: 'SINGLE_ELIMINATION' }],
    completeAllMatchUps: true,
  });
  const struct = c.tournamentRecord.events[0].drawDefinitions[0].structures[0];
  const r1 = struct.matchUps.find((m) => m.roundNumber === 1 && m.winningSide);
  r1.winningSide = r1.winningSide === 1 ? 2 : 1;
  c.tournamentRecord.parentOrganisation = { organisationId: 'prov-A', organisationName: 'Provider A' };
  rows.push({ tournamentId: c.tournamentRecord.tournamentId, providerId: 'prov-A', data: c.tournamentRecord });

  void tournamentEngine;
  const model = analyzeRecords(rows);
  const md = renderReport(model, { generatedAt: '(self-test)', database: 'self-test', limit: 0 });
  console.log(md);
  console.log('\n--- self-test assertions ---');
  console.log('providers=', model.totals.providers, '(expect 2)');
  console.log('draws=', model.totals.draws, '(expect 3)');
  console.log('drawsWithInconsistencies=', model.totals.drawsWithInconsistencies, '(expect 1)');
  console.log('drawsIncomplete=', model.totals.drawsIncomplete, '(expect >=1)');
}

// -------- live DB pass --------
async function liveRun(opts) {
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT) || 5432,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    max: 4,
  });
  const limitClause = opts.limit ? ` LIMIT ${Number(opts.limit)}` : '';
  const t0 = Date.now();
  process.stderr.write(`Querying tournaments${limitClause}...\n`);
  const { rows } = await pool.query(
    `SELECT tournament_id AS "tournamentId", provider_id AS "providerId", data
       FROM tournaments ORDER BY provider_id, tournament_id${limitClause}`,
  );
  process.stderr.write(`Fetched ${rows.length} tournamentRecords in ${Date.now() - t0}ms. Analyzing...\n`);
  const model = analyzeRecords(rows);
  const md = renderReport(model, {
    generatedAt: new Date().toISOString(),
    database: process.env.PG_DATABASE || 'unknown',
    limit: opts.limit || 0,
  });
  fs.writeFileSync(opts.out, md);
  process.stderr.write(
    `Done: ${model.totals.tournaments} tournaments, ${model.totals.draws} draws, ` +
      `${model.totals.drawsWithInconsistencies} with inconsistencies, ` +
      `${model.totals.drawsIncomplete} incomplete. Report -> ${opts.out}\n`,
  );
  await pool.end();
}

function parseArgs(argv) {
  const opts = { out: path.join(process.cwd(), 'tournament-records-audit.md'), limit: 0, selfTest: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') opts.out = argv[++i];
    else if (argv[i] === '--limit') opts.limit = Number(argv[++i]);
    else if (argv[i] === '--self-test') opts.selfTest = true;
  }
  return opts;
}

(async () => {
  const opts = parseArgs(process.argv);
  if (opts.selfTest) return selfTest();
  return liveRun(opts);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
