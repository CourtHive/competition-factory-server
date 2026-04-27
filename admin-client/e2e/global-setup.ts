/**
 * Playwright globalSetup — ensures a known e2e super-admin user exists.
 *
 * Runs once before any spec. Uses the existing admin-user.mjs CLI which
 * goes straight to Postgres (or LevelDB) and is the same path the
 * developer uses to provision their own admin account, so no special
 * dev-only auth bypass is required.
 *
 * Idempotent: tries create first, then reset-password to normalise the
 * password if the user already existed.
 */
import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './helpers/login';

// admin-client is "type": "module" — `__dirname` doesn't exist, derive it.
const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(HERE, '..', '..');
const SCRIPT_PATH = 'src/scripts/admin-user.mjs';

function runScript(args: string[]): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolveRun) => {
    const child = spawn('node', [SCRIPT_PATH, ...args], { cwd: SERVER_DIR, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('exit', (code) => resolveRun({ code: code ?? 1, stdout, stderr }));
    child.on('error', (err) => resolveRun({ code: 1, stdout, stderr: stderr + err.message }));
  });
}

async function assertServerReachable(): Promise<void> {
  const base = process.env.E2E_API_BASE ?? 'http://127.0.0.1:3000';
  try {
    const res = await fetch(`${base}/factory/version`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`server returned ${res.status}`);
  } catch (err) {
    throw new Error(
      `[e2e/global-setup] cannot reach the NestJS server at ${base} — ` +
        `start it with \`pnpm watch\` (or \`pnpm start\`) in another terminal before running e2e.\n` +
        `(underlying error: ${(err as Error).message})`,
    );
  }
}

export default async function globalSetup(): Promise<void> {
  await assertServerReachable();

  // Try create — succeeds first run, errors with "already exists" subsequently.
  const createResult = await runScript(['create', '-e', E2E_ADMIN_EMAIL, '-p', E2E_ADMIN_PASSWORD]);

  if (createResult.code === 0) {
    console.log(`[e2e/global-setup] created super-admin ${E2E_ADMIN_EMAIL}`);
    return;
  }

  // Already exists (or some other failure) — normalise the password so
  // login helpers can rely on it.
  const resetResult = await runScript([
    'reset-password',
    '-e',
    E2E_ADMIN_EMAIL,
    '-p',
    E2E_ADMIN_PASSWORD,
  ]);

  if (resetResult.code !== 0) {
    throw new Error(
      `[e2e/global-setup] could not provision ${E2E_ADMIN_EMAIL}.\n` +
        `  create stderr: ${createResult.stderr.trim()}\n` +
        `  reset stderr:  ${resetResult.stderr.trim()}\n` +
        `Hint: ensure the dev server's database is reachable (PG_* env vars or LevelDB).`,
    );
  }

  console.log(`[e2e/global-setup] reset password for existing super-admin ${E2E_ADMIN_EMAIL}`);
}
