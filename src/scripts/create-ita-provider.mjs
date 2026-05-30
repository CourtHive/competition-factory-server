/**
 * Create-or-update the ITA (Intercollegiate Tennis Association)
 * provider with an ITA-themed `providerConfigCaps.branding` block.
 * Idempotent — safe to re-run.
 *
 * Prerequisites:
 *   - PostgreSQL: PG_* vars in `.env`, schema applied
 *
 * Usage:
 *   node src/scripts/create-ita-provider.mjs            # create or update
 *   node src/scripts/create-ita-provider.mjs --dry-run  # show what would happen
 *   node src/scripts/create-ita-provider.mjs --force    # also overwrite name/abbr
 *
 * Branding source: derived from wearecollegetennis.com — primary
 * navy `#15365d` (the brand color used 7× inline on their homepage
 * and matching the ITA logo), accent gold `#fcb900` (matches the
 * tennis-ball yellow in the logo). The themeTokens map covers
 * `--tmx-*` for the TMX client and `--chc-*` for the public viewer.
 */

import minimist from 'minimist';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';

const args = minimist(process.argv.slice(2), {
  boolean: ['dry-run', 'force'],
});

const ABBR = 'ITA';
const NAME = 'Intercollegiate Tennis Association';

const ITA_NAVY = '#15365d';
const ITA_NAVY_HOVER = '#1f4d85';
const ITA_GOLD = '#fcb900';

const ITA_BRANDING = {
  appName: 'ITA',
  navbarLogoUrl: 'https://wearecollegetennis.com/wp-content/uploads/2019/01/ITA-logo-header.png',
  navbarLogoAlt: 'Intercollegiate Tennis Association',
  splashLogoUrl: 'https://wearecollegetennis.com/wp-content/uploads/2019/05/ITA-logo-png.png',
  accentColor: ITA_NAVY,
  themeTokens: {
    // ── TMX (`--tmx-*`) ──
    '--tmx-accent-blue': ITA_NAVY,
    '--tmx-fill-accent': ITA_NAVY,
    '--tmx-border-focus': ITA_NAVY,
    '--tmx-status-info': ITA_NAVY,
    '--tmx-container-link': ITA_NAVY,
    '--tmx-panel-blue-bg': '#e9eef5',
    '--tmx-panel-blue-border': ITA_NAVY,
    '--tmx-accent-orange': ITA_GOLD,
    '--tmx-panel-yellow-bg': '#fff8e1',
    '--tmx-panel-yellow-border': ITA_GOLD,
    '--tmx-bg-highlight': '#fff8e1',
    // ── courthive-public (`--chc-*`) ──
    '--chc-text-link': ITA_NAVY,
    '--chc-text-link-hover': ITA_NAVY_HOVER,
    '--chc-status-info': ITA_NAVY,
    '--chc-format-code-color': ITA_NAVY,
    '--chc-container-link': ITA_NAVY,
    '--chc-border-focus': ITA_NAVY,
  },
};

async function main() {
  const pg = await import('pg');
  const { Pool } = pg.default || pg;
  const pool = new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT) || 5432,
    user: process.env.PG_USER || 'courthive',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'courthive',
  });

  try {
    const existing = await pool.query(
      `SELECT provider_id, organisation_abbreviation, organisation_name, data
       FROM providers
       WHERE organisation_abbreviation = $1`,
      [ABBR],
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      const providerId = row.provider_id;
      const data = row.data || {};
      const newCaps = {
        ...(data.providerConfigCaps || {}),
        branding: ITA_BRANDING,
      };
      const newData = {
        ...data,
        organisationId: providerId,
        providerConfigCaps: newCaps,
      };

      console.log(`Provider "${ABBR}" already exists — providerId: ${providerId}`);
      console.log(`Will update providerConfigCaps.branding with the ITA theme.`);

      if (args['dry-run']) {
        console.log('\n--dry-run: showing payload, NOT writing.');
        console.log(JSON.stringify(newCaps, null, 2));
        return;
      }

      await pool.query(
        `UPDATE providers
            SET data = $2,
                organisation_name = CASE WHEN $3::boolean THEN $4 ELSE organisation_name END,
                organisation_abbreviation = CASE WHEN $3::boolean THEN $5 ELSE organisation_abbreviation END,
                updated_at = NOW()
          WHERE provider_id = $1`,
        [providerId, JSON.stringify(newData), !!args.force, NAME, ABBR],
      );
      console.log(`\n✔ Updated ITA provider branding.`);
      console.log(`  providerId: ${providerId}`);
      return;
    }

    // Brand-new ITA provider.
    const providerId = randomUUID();
    const data = {
      organisationId: providerId,
      organisationAbbreviation: ABBR,
      organisationName: NAME,
      providerConfigCaps: { branding: ITA_BRANDING },
    };

    console.log(`Provider "${ABBR}" does not exist — will create.`);
    console.log(`  providerId: ${providerId}`);

    if (args['dry-run']) {
      console.log('\n--dry-run: showing payload, NOT writing.');
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    await pool.query(
      `INSERT INTO providers (provider_id, organisation_abbreviation, organisation_name, data)
       VALUES ($1, $2, $3, $4)`,
      [providerId, ABBR, NAME, JSON.stringify(data)],
    );
    console.log(`\n✔ Created ITA provider.`);
    console.log(`  providerId: ${providerId}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('create-ita-provider failed:', err);
  process.exit(1);
});
