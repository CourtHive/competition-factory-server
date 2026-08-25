/**
 * Create-or-update the INTENNSE provider with an INTENNSE-themed
 * `providerConfigCaps.branding` block. Idempotent — safe to re-run.
 *
 * Prerequisites:
 *   - PostgreSQL: PG_* vars in `.env`, schema applied
 *   (No AMS console or CFS server required — writes directly to Postgres.)
 *
 * Usage:
 *   node src/scripts/create-intennse-provider.mjs            # create or update
 *   node src/scripts/create-intennse-provider.mjs --dry-run  # show payload, no write
 *   node src/scripts/create-intennse-provider.mjs --force    # also overwrite name/abbr
 *
 * Targets the provider whose abbreviation is any of NTNS / INTENNSE — prod's real row is
 * NTNS ("INTENNSE Tennis"), local dev seeds INTENNSE. Override with INTENNSE_ABBR /
 * INTENNSE_NAME. If more than one matches it refuses rather than guessing, and it creates
 * only when none matches, so it can no longer duplicate the provider it meant to update.
 *
 * Branding source: intennse.com live design system — green-black canvas
 * (#020504), forest surfaces (#183029), signature "rad-green" accent
 * (#e0e722), "Area" display type + "Space Mono" numerics. The theme-aware
 * palette and @font-face live in the stylesheet referenced by stylesheetUrl;
 * themeTokens carries the brand-invariant accent + font-family (applied
 * inline, so it beats bundle CSS).
 */

import minimist from 'minimist';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';

const args = minimist(process.argv.slice(2), {
  boolean: ['dry-run', 'force'],
});

// The real INTENNSE provider is abbreviated **NTNS**, not INTENNSE — prod is
// `b3407edd-b9df-450c-b45d-fd0bca5a7e62` / NTNS / "INTENNSE Tennis". This script previously
// looked up `organisation_abbreviation = 'INTENNSE'`, found nothing in prod, fell through to the
// create branch and INSERTed a **duplicate** provider under a fresh UUID rather than updating the
// real one. So we match a set of candidate abbreviations and only ever create when none matches.
const CANONICAL_ABBR = process.env.INTENNSE_ABBR || 'NTNS';
const CANONICAL_NAME = process.env.INTENNSE_NAME || 'INTENNSE Tennis';
// Legacy and local rows may still carry the bare 'INTENNSE' abbreviation (local dev seeds
// 4309c1ab-… that way), so match those too and UPDATE them instead of duplicating.
const LOOKUP_ABBRS = [...new Set([CANONICAL_ABBR, 'NTNS', 'INTENNSE'])];

const RAD_GREEN = '#e0e722';
const FOREST = '#183029';
const TEAL = '#20c8a0';
const AMBER = '#e8a020';
const RED = '#e04040';

// Colors-only interim (matches what is seeded on the prod NTNS provider).
// themeTokens is applied FLAT to documentElement (overrides both light AND
// dark), so we seed only theme-SAFE tokens here — accents, fills, status,
// focus, and font-family (with a system fallback; Area renders once the
// stylesheet below is hosted). The green-black canvas + `--chc-text-link`
// are theme-DEPENDENT and ship with the theme-aware stylesheet, NOT here —
// pushing them flat would break light mode / fail contrast on the public viewer.
const INTENNSE_BRANDING = {
  appName: 'INTENNSE',
  // Logos omitted until real assets are hosted — navbar/splash fall back to
  // the "INTENNSE" appName text cleanly (a 404 image URL would show broken).
  // navbarLogoUrl: 'https://media.taffylabs-intennse.com/brand/logo-nav.svg',
  // splashLogoUrl: 'https://media.taffylabs-intennse.com/brand/logo-splash.svg',
  accentColor: RAD_GREEN,
  themeTokens: {
    '--tmx-font-family': "'Area', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    '--tmx-accent-blue': RAD_GREEN,
    '--tmx-accent-teal': TEAL,
    '--tmx-accent-orange': AMBER,
    '--tmx-accent-red': RED,
    '--tmx-fill-accent': FOREST,
    '--tmx-border-focus': RAD_GREEN,
    '--tmx-status-success': TEAL,
    '--tmx-status-warning': AMBER,
    '--tmx-status-error': RED,
    '--chc-border-focus': RAD_GREEN,
  },
  // DEFERRED — add once the theme stylesheet + Area/Space Mono fonts are hosted
  // on a CORS-enabled origin (NOT a TMX/public path — loaded by TMX AND
  // courthive-public, so it must be an absolute https URL). This delivers the
  // @font-face declarations and the theme-aware light/dark green-black palette.
  // stylesheetUrl: 'https://<intennse-or-courthive-cdn>/intennse-theme.css',
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
       WHERE organisation_abbreviation = ANY($1)`,
      [LOOKUP_ABBRS],
    );

    // More than one match means the duplicate this script used to create already exists (or a
    // second org legitimately shares an abbreviation). Either way, guessing which to brand would
    // be worse than stopping — reconcile by hand.
    if (existing.rows.length > 1) {
      console.error(`Ambiguous: ${existing.rows.length} providers match ${LOOKUP_ABBRS.join(' / ')}:`);
      for (const r of existing.rows) {
        console.error(`  ${r.provider_id}  ${r.organisation_abbreviation}  ${r.organisation_name}`);
      }
      console.error('\nRefusing to guess which is canonical. Merge or remove the extras, then re-run.');
      process.exitCode = 1;
      return;
    }

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      const providerId = row.provider_id;
      const data = row.data || {};
      const newCaps = {
        ...(data.providerConfigCaps || {}),
        branding: INTENNSE_BRANDING,
      };
      const newData = {
        ...data,
        organisationId: providerId,
        providerConfigCaps: newCaps,
      };

      console.log(
        `Provider "${row.organisation_abbreviation}" (${row.organisation_name}) already exists — providerId: ${providerId}`,
      );
      console.log(`Will update providerConfigCaps.branding with the INTENNSE theme.`);

      // `calendars` is keyed by organisation_abbreviation, so renaming the abbreviation orphans the
      // provider's calendar until it is re-keyed. Only --force does it, and it says so first.
      if (args.force && row.organisation_abbreviation !== CANONICAL_ABBR) {
        console.warn(
          `\n⚠ --force will rename the abbreviation ${row.organisation_abbreviation} → ${CANONICAL_ABBR}.` +
            `\n  \`calendars\` is keyed by abbreviation — re-key the calendar row too or this provider's` +
            `\n  tournaments stop resolving. Drop --force if you only meant to update branding.`,
        );
      }

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
        [providerId, JSON.stringify(newData), !!args.force, CANONICAL_NAME, CANONICAL_ABBR],
      );
      console.log(`\n✔ Updated INTENNSE provider branding.`);
      console.log(`  providerId: ${providerId}`);
      return;
    }

    // Brand-new INTENNSE provider — only reached when NO candidate abbreviation matched.
    const providerId = randomUUID();
    const data = {
      organisationId: providerId,
      organisationAbbreviation: CANONICAL_ABBR,
      organisationName: CANONICAL_NAME,
      providerConfigCaps: { branding: INTENNSE_BRANDING },
    };

    console.log(`No provider matches ${LOOKUP_ABBRS.join(' / ')} — will create "${CANONICAL_ABBR}".`);
    console.log(`  providerId: ${providerId}`);

    if (args['dry-run']) {
      console.log('\n--dry-run: showing payload, NOT writing.');
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    await pool.query(
      `INSERT INTO providers (provider_id, organisation_abbreviation, organisation_name, data)
       VALUES ($1, $2, $3, $4)`,
      [providerId, CANONICAL_ABBR, CANONICAL_NAME, JSON.stringify(data)],
    );
    console.log(`\n✔ Created INTENNSE provider.`);
    console.log(`  providerId: ${providerId}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('create-intennse-provider failed:', err);
  process.exit(1);
});
