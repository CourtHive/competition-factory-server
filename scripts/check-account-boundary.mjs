#!/usr/bin/env node
/**
 * Account extraction boundary guard.
 *
 * `src/modules/account/` is a future-microservice candidate (auth / identity /
 * email — see Mentat/planning/ACCOUNT_SERVICE_BOUNDARY.md). The single rule that
 * keeps the eventual CFS -> AMS lift-out an NGINX route flip rather than a
 * refactor:
 *
 *   Nothing OUTSIDE src/modules/account/ may import from INSIDE it, except via
 *   the public module surface (AccountModule) or the shared verify-side infra
 *   exceptions listed below.
 *
 * This script scans every source file outside account/, resolves each import
 * that lands inside account/, and fails (exit 1) on any import that is not an
 * allowed exception. Zero runtime deps; wired into lint/CI via package.json.
 *
 * ESLint's core no-restricted-imports cannot express "deny a directory except
 * these specific files" (its `group` globs have no working allow-negation), so
 * the boundary is enforced here instead.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(REPO_ROOT, 'src');
const ACCOUNT_DIR = join(SRC, 'modules', 'account');

/**
 * Import specifiers that resolve into account/ but are deliberately shared
 * infrastructure. Matched against the path RELATIVE to `src/modules/account/`
 * (no extension), so `auth/decorators/roles.decorator` etc.
 *
 * Keep this list in sync with the exception table in ACCOUNT_SERVICE_BOUNDARY.md.
 */
const ALLOWED = [
  // Public module surface + module entrypoints (Nest wiring / test harnesses)
  /^account\.module$/,
  /^auth\/auth\.module$/,
  // Decorators — pure Nest metadata, no account-service runtime dependency
  /^auth\/decorators\/[^/]+$/,
  // Verify-side enforcement guards (paired with the decorators above)
  /^auth\/guards\/role\.guard$/,
  /^auth\/guards\/socket\.guard$/,
  // Identity hydration shared by the HTTP middleware + the WS gateway
  /^auth\/helpers\/buildUserContext$/,
];

// import ... from '...'  |  export ... from '...'  |  require('...')  |  import('...')
const SPECIFIER_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (full === ACCOUNT_DIR) continue; // files inside account/ may import account/
      walk(full, out);
    } else if (/\.(ts|js|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Resolve an import specifier to an absolute path under src/, or null. */
function resolveSpecifier(spec, fromFile) {
  if (spec.startsWith('.')) return resolve(dirname(fromFile), spec);
  // Non-relative: the repo imports app code via the `src/` baseUrl, e.g.
  // `src/modules/account/...`. Anything else (node_modules, aliases) isn't ours.
  if (spec.startsWith('src/')) return join(REPO_ROOT, spec);
  return null;
}

function accountSubpath(absPath) {
  const rel = relative(ACCOUNT_DIR, absPath);
  if (rel.startsWith('..')) return null; // not inside account/
  return rel.replace(/\.(ts|js|mjs)$/, '').replace(/\\/g, '/');
}

const violations = [];
let scanned = 0;
let crossings = 0;

for (const file of walk(SRC)) {
  scanned += 1;
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(SPECIFIER_RE)) {
    const spec = match[1] ?? match[2];
    if (!spec) continue;
    const abs = resolveSpecifier(spec, file);
    if (!abs) continue;
    const sub = accountSubpath(abs);
    if (sub === null) continue; // does not reach into account/
    crossings += 1;
    if (!ALLOWED.some((rx) => rx.test(sub))) {
      violations.push({ file: relative(REPO_ROOT, file), spec, sub });
    }
  }
}

if (violations.length > 0) {
  console.error('\n✖ Account boundary violations — imports into src/modules/account/ internals');
  console.error('  from outside it that are not an allowed shared-infra exception:\n');
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    imports "${v.spec}"  (account/${v.sub})`);
  }
  console.error(
    `\n  ${violations.length} violation(s). Route through AccountModule or relocate genuinely-shared`,
  );
  console.error('  infra to neutral territory. See Mentat/planning/ACCOUNT_SERVICE_BOUNDARY.md.\n');
  process.exit(1);
}

console.log(
  `✓ Account boundary clean — scanned ${scanned} files, ${crossings} allowed cross-boundary import(s).`,
);
