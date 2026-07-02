#!/usr/bin/env node
/**
 * survey-matchup-format-variance.cjs
 *
 * Read-only sweep of every tournamentRecord in the Postgres `tournaments` table, running each
 * draw through getMatchUpFormatVariance to surface WITHIN-structure matchUpFormat variance —
 * especially the revert pattern (a round that departs from the structure's format then returns),
 * the fingerprint of an in-tournament format change (e.g. a weather-shortened day). Cross-
 * structure variance (consolation plays shorter) is tallied separately as expected/informational.
 *
 * Usage: source competition-factory-server/.env && node scripts/survey-matchup-format-variance.cjs [--out report.md] [--limit N]
 */
const fs = require('fs');
const path = require('path');
const { drawsGovernor } = require('tods-competition-factory');

function emptyProvider(name) {
  return {
    providerName: name,
    tournaments: new Set(),
    draws: 0,
    drawsWithinVariance: 0,
    drawsWithRevert: 0,
    drawsCrossOnly: 0,
  };
}

function analyze(rows) {
  const providers = new Map();
  const totals = { tournaments: 0, draws: 0, withinVariance: 0, revert: 0, crossOnly: 0 };
  const revertInstances = [];
  const withinInstances = [];

  for (const row of rows) {
    const record = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    if (!record) continue;
    const org = record.parentOrganisation || {};
    const providerName = org.organisationName || org.organisationAbbreviation || row.providerId || 'UNASSIGNED';
    if (!providers.has(providerName)) providers.set(providerName, emptyProvider(providerName));
    const agg = providers.get(providerName);
    agg.tournaments.add(row.tournamentId || record.tournamentId);
    totals.tournaments += 1;

    for (const event of record.events || []) {
      for (const drawDefinition of event.drawDefinitions || []) {
        agg.draws += 1;
        totals.draws += 1;
        let result;
        try {
          result = drawsGovernor.getMatchUpFormatVariance({ drawDefinition, event });
        } catch {
          continue;
        }
        const variance = (result && result.variance) || { structures: [], crossStructureVariance: false };
        const within = variance.structures.length > 0;
        const revert = variance.structures.some((s) => s.revertPattern);
        if (within) {
          agg.drawsWithinVariance += 1;
          totals.withinVariance += 1;
          collectInstances({ variance, event, record, row, providerName, revertInstances, withinInstances, revert });
          agg.drawsWithRevert += revert ? 1 : 0;
          totals.revert += revert ? 1 : 0;
        } else if (variance.crossStructureVariance) {
          agg.drawsCrossOnly += 1;
          totals.crossOnly += 1;
        }
      }
    }
  }
  return { providers, totals, revertInstances, withinInstances };
}

function collectInstances(ctx) {
  const { variance, event, record, row, providerName, revertInstances, withinInstances, revert } = ctx;
  for (const s of variance.structures) {
    const instance = {
      providerName,
      tournamentName: record.tournamentName || row.tournamentId,
      eventName: event.eventName || event.eventId,
      structure: s.structureName || s.stage || 'Structure',
      baselineFormat: s.baselineFormat,
      distinctFormats: s.distinctFormats,
      rounds: s.rounds.filter((r) => r.differsFromBaseline).map((r) => `R${r.roundNumber}:${r.formats.join('/')}`),
      revert: s.revertPattern,
    };
    withinInstances.push(instance);
    if (s.revertPattern) revertInstances.push(instance);
  }
  void revert;
}

function trunc(s, n = 34) {
  s = String(s == null ? '' : s).replace(/\|/g, '\\|');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function renderReport({ providers, totals, revertInstances, withinInstances }, meta) {
  const L = [];
  L.push(`# MatchUpFormat Variance — Historical Survey`, '');
  L.push(`Generated: ${meta.generatedAt}`, '');
  L.push(`Source: \`${meta.database}\` · table \`tournaments\` · all providers`, '');
  L.push(`Query: getMatchUpFormatVariance (per draw). Within-structure variance = a structure's`);
  L.push(`played matchUps do not all share one format; revert = departed then returned (weather signal).`, '');

  L.push(`## Summary`, '');
  L.push(`| Metric | Value |`, `| --- | --- |`);
  L.push(`| Tournaments | ${totals.tournaments} |`);
  L.push(`| Draws | ${totals.draws} |`);
  L.push(`| Draws with WITHIN-structure variance | ${totals.withinVariance} |`);
  L.push(`| Draws with a REVERT pattern (weather signal) | ${totals.revert} |`);
  L.push(`| Draws with cross-structure variance only (expected) | ${totals.crossOnly} |`, '');

  L.push(`## Per-provider`, '');
  L.push(`| Provider | Tourns | Draws | Within-variance | Revert | Cross-only |`);
  L.push(`| --- | ---: | ---: | ---: | ---: | ---: |`);
  const provs = [...providers.values()]
    .filter((p) => p.drawsWithinVariance || p.drawsCrossOnly)
    .sort((a, b) => b.drawsWithRevert - a.drawsWithRevert || b.drawsWithinVariance - a.drawsWithinVariance);
  for (const p of provs) {
    L.push(
      `| ${p.providerName} | ${p.tournaments.size} | ${p.draws} | ${p.drawsWithinVariance} | ${p.drawsWithRevert} | ${p.drawsCrossOnly} |`,
    );
  }
  L.push('');

  L.push(`## Revert-pattern instances (weather-shortening candidates)`, '');
  if (!revertInstances.length) {
    L.push(`_None found._`, '');
  } else {
    L.push(`| Provider | Tournament | Event | Structure | Baseline | Departing rounds |`);
    L.push(`| --- | --- | --- | --- | --- | --- |`);
    for (const i of revertInstances.slice(0, 60)) {
      L.push(
        `| ${trunc(i.providerName)} | ${trunc(i.tournamentName)} | ${trunc(i.eventName)} | ${i.structure} | ${i.baselineFormat} | ${i.rounds.join(', ')} |`,
      );
    }
    if (revertInstances.length > 60) L.push('', `_+${revertInstances.length - 60} more not shown._`);
    L.push('');
  }

  // non-revert within-variance (format changed but did not return) — also worth a look
  const nonRevert = withinInstances.filter((i) => !i.revert);
  if (nonRevert.length) {
    L.push(`## Within-structure variance without revert (max 40)`, '');
    L.push(`| Provider | Tournament | Structure | Baseline | Departing rounds |`);
    L.push(`| --- | --- | --- | --- | --- |`);
    for (const i of nonRevert.slice(0, 40)) {
      L.push(
        `| ${trunc(i.providerName)} | ${trunc(i.tournamentName)} | ${i.structure} | ${i.baselineFormat} | ${i.rounds.join(', ')} |`,
      );
    }
    L.push('');
  }
  return L.join('\n');
}

async function main() {
  const opts = { out: path.join(process.cwd(), 'matchup-format-variance.md'), limit: 0 };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--out') opts.out = process.argv[++i];
    else if (process.argv[i] === '--limit') opts.limit = Number(process.argv[++i]);
  }
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
  process.stderr.write(`Querying tournaments${limitClause}...\n`);
  const { rows } = await pool.query(
    `SELECT tournament_id AS "tournamentId", provider_id AS "providerId", data FROM tournaments ORDER BY provider_id, tournament_id${limitClause}`,
  );
  process.stderr.write(`Analyzing ${rows.length} records...\n`);
  const model = analyze(rows);
  const md = renderReport(model, { generatedAt: new Date().toISOString(), database: process.env.PG_DATABASE });
  fs.writeFileSync(opts.out, md);
  process.stderr.write(
    `Done: ${model.totals.draws} draws — ${model.totals.withinVariance} within-variance, ${model.totals.revert} revert, ${model.totals.crossOnly} cross-only. -> ${opts.out}\n`,
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
