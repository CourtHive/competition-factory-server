#!/usr/bin/env node
/**
 * Sync @courthive/i18n's published locales + manifest into CFS's runtime
 * directory at <cwd>/i18n/. Runs on postinstall (after pnpm install
 * resolves the package via link:../courthive-i18n in dev or via npm in
 * prod) and on prebuild (so build artifacts ship with current locales).
 *
 * Safe to run when the package isn't present yet (warns + exits 0) so a
 * fresh checkout's `pnpm install` doesn't error before the dep resolves.
 *
 * Hot-reload at runtime via POST /admin/i18n/refresh after this script
 * has been re-run with newer @courthive/i18n content on disk.
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const cwd = process.cwd();
const pkgRoot = resolve(cwd, 'node_modules', '@courthive', 'i18n', 'dist');
const targetRoot = resolve(cwd, 'i18n');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyManifest() {
  const src = join(pkgRoot, 'manifest.json');
  const dest = join(targetRoot, 'manifest.json');
  if (!(await exists(src))) {
    console.warn(`[sync-i18n] manifest.json missing in @courthive/i18n dist at ${src}; skipping.`);
    return false;
  }
  await mkdir(targetRoot, { recursive: true });
  await copyFile(src, dest);
  return true;
}

async function copyLocales() {
  const srcDir = join(pkgRoot, 'locales');
  const destDir = join(targetRoot, 'locales');
  if (!(await exists(srcDir))) {
    console.warn(`[sync-i18n] locales/ missing in @courthive/i18n dist at ${srcDir}; skipping.`);
    return 0;
  }
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir);
  let copied = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    await copyFile(join(srcDir, entry), join(destDir, entry));
    copied += 1;
  }
  return copied;
}

async function main() {
  if (!(await exists(pkgRoot))) {
    console.warn(`[sync-i18n] @courthive/i18n not installed at ${pkgRoot}; skipping (run pnpm install first).`);
    return;
  }
  const manifest = await copyManifest();
  const localesCopied = await copyLocales();
  if (manifest || localesCopied) {
    console.log(`[sync-i18n] synced ${localesCopied} locale file(s) + manifest to ${targetRoot}`);
  }
}

main().catch((err) => {
  console.error('[sync-i18n] failed:', err?.message ?? err);
  // Do not fail postinstall on i18n sync errors — CFS can still boot;
  // /i18n endpoints will return 404 until the directory is populated.
  process.exit(0);
});
