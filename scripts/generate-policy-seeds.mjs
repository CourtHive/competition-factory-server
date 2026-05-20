#!/usr/bin/env node
/**
 * generate-policy-seeds.mjs
 *
 * Dumps factory's POLICY_RANKING_POINTS_* fixtures to seed JSON files that
 * `PolicySeedLoader` will upsert into `policies` on next boot.
 *
 * Default output: every fixture is written as TEMPLATE_REF under
 * `seeds/policies/_global/<lowercase-name>-<version>.json` so it loads
 * successfully without depending on the `providers` table. Move files
 * into `seeds/policies/<providerId>/` and flip `visibility` to
 * `PROVIDER_PRIVATE` (also setting `providerId`) once the provider mapping
 * is decided.
 *
 * Usage:
 *   node scripts/generate-policy-seeds.mjs                 # write defaults
 *   node scripts/generate-policy-seeds.mjs --dry-run       # print paths only
 *   node scripts/generate-policy-seeds.mjs --force         # overwrite existing
 */
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

import { fixtures } from 'tods-competition-factory';

const POLICY_TYPE = 'rankingPoints';
const DEFAULT_VISIBILITY = 'TEMPLATE_REF';
const DEFAULT_PROVIDER_DIR = '_global';
const DEFAULT_VERSION = '1.0.0';

// Fixture key → seed metadata. Order matches what we want to migrate.
const POLICIES = [
  { key: 'POLICY_RANKING_POINTS_BASIC',                name: 'BASIC' },
  { key: 'POLICY_RANKING_POINTS_ITF_JUNIOR',           name: 'ITF_JUNIOR' },
  { key: 'POLICY_RANKING_POINTS_ITF_WTT',              name: 'ITF_WTT' },
  { key: 'POLICY_RANKING_POINTS_ATP',                  name: 'ATP' },
  { key: 'POLICY_RANKING_POINTS_WTA',                  name: 'WTA' },
  { key: 'POLICY_RANKING_POINTS_USTA_JUNIOR_2025',     name: 'USTA_JUNIOR_2025' },
  { key: 'POLICY_RANKING_POINTS_USTA_JUNIOR_2026',     name: 'USTA_JUNIOR_2026' },
  { key: 'POLICY_RANKING_POINTS_TENNIS_EUROPE',        name: 'TENNIS_EUROPE' },
  { key: 'POLICY_RANKING_POINTS_TENNIS_CANADA',        name: 'TENNIS_CANADA' },
  { key: 'POLICY_RANKING_POINTS_TENNIS_AUSTRALIA',     name: 'TENNIS_AUSTRALIA' },
  { key: 'POLICY_RANKING_POINTS_LTA',                  name: 'LTA' },
  { key: 'POLICY_RANKING_POINTS_CTS',                  name: 'CTS' },
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

const SEEDS_ROOT = join(process.cwd(), 'seeds', 'policies');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeSeed(seed, outputPath) {
  if ((await exists(outputPath)) && !force) {
    console.log(`SKIP  ${outputPath} (exists; pass --force to overwrite)`);
    return 'skipped';
  }

  if (dryRun) {
    console.log(`DRY   ${outputPath}`);
    return 'dry';
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(seed, null, 2) + '\n');
  console.log(`WRITE ${outputPath}`);
  return 'written';
}

async function main() {
  const allPolicies = fixtures?.policies;
  if (!allPolicies) {
    console.error('factory.fixtures.policies is not exposed; check tods-competition-factory build');
    process.exit(1);
  }

  let written = 0;
  let skipped = 0;
  const missing = [];

  for (const item of POLICIES) {
    const wrapped = allPolicies[item.key];
    if (!wrapped) {
      missing.push(item.key);
      continue;
    }

    const definition = wrapped[POLICY_TYPE];
    if (!definition) {
      console.warn(`WARN  ${item.key} has no rankingPoints key; skipping`);
      continue;
    }

    const seed = {
      providerId: null,
      policyType: POLICY_TYPE,
      name: item.name,
      version: definition.policyVersion ?? DEFAULT_VERSION,
      visibility: DEFAULT_VISIBILITY,
      definition,
      metadata: {
        source: 'tods-competition-factory@3.x fixtures',
        fixtureKey: item.key,
        generatedAt: new Date().toISOString(),
      },
    };

    const fileName = `${item.name.toLowerCase()}-${seed.version}.json`;
    const outputPath = join(SEEDS_ROOT, DEFAULT_PROVIDER_DIR, fileName);

    const outcome = await writeSeed(seed, outputPath);
    if (outcome === 'written') written++;
    else if (outcome === 'skipped') skipped++;
  }

  if (missing.length) {
    console.warn(`\nMissing fixtures (factory build out of date?): ${missing.join(', ')}`);
  }

  console.log(`\nDone. ${written} written, ${skipped} skipped.`);
  console.log(
    'Next: review each seed, set providerId + visibility per the deployment plan, ' +
      'and move files from _global/ into the appropriate provider directory.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
