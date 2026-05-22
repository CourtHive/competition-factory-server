#!/usr/bin/env node
/**
 * Standalone email-pipeline smoke test.
 *
 * Loads env from .env, picks the verification template, renders it,
 * sends through the Resend adapter, and prints the message id. Use to
 * confirm that:
 *   - RESEND_API_KEY is set and valid
 *   - EMAIL_FROM matches a verified sending domain in Resend
 *   - DNS records have propagated (otherwise Resend rejects EMAIL_FROM)
 *   - The build is shipping email templates at the expected path
 *
 * Usage:
 *   node src/scripts/test-email.mjs you@example.com
 *   node src/scripts/test-email.mjs you@example.com --template=email-verification
 *
 * Run AGAINST THE BUILD (not src) so the template-resolution path
 * exercises the production layout:
 *   pnpm build && node src/scripts/test-email.mjs ...
 *
 * Exit codes:
 *   0  success — message accepted by Resend (real delivery may still fail at recipient)
 *   1  configuration error (missing key, missing FROM, template not found)
 *   2  send failed (network / API error / domain not verified)
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const to = args.find((a) => !a.startsWith('--'));
const templateArg = args.find((a) => a.startsWith('--template='));
const template = templateArg ? templateArg.slice('--template='.length) : 'email-verification';

if (!to) {
  console.error('Usage: node src/scripts/test-email.mjs <recipient@example.com> [--template=<name>]');
  process.exit(1);
}

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM;
if (!apiKey) {
  console.error('RESEND_API_KEY is not set in environment.');
  process.exit(1);
}
if (!from) {
  console.error('EMAIL_FROM is not set in environment.');
  process.exit(1);
}

// Look for the template in build/ first (matches prod layout), fall back
// to src/ so this script is useful pre-build too.
const candidates = [
  join(__dirname, '..', '..', 'build', 'src', 'modules', 'account', 'email', 'templates', `${template}.ejs`),
  join(__dirname, '..', 'modules', 'account', 'email', 'templates', `${template}.ejs`),
];

let templatePath;
for (const candidate of candidates) {
  try {
    readFileSync(candidate);
    templatePath = candidate;
    break;
  } catch {
    // try next
  }
}

if (!templatePath) {
  console.error(`Template ${template}.ejs not found. Searched:\n  ${candidates.join('\n  ')}`);
  console.error('Have you run `pnpm build`?');
  process.exit(1);
}

const html = ejs.render(readFileSync(templatePath, 'utf8'), {
  firstName: 'Test',
  email: to,
  verifyUrl: 'https://courthive.com/verify/test-token-not-real',
  expiresInMinutes: 30,
});

let Resend;
try {
  ({ Resend } = await import('resend'));
} catch {
  console.error('Resend SDK not installed. Run `pnpm install` in competition-factory-server first.');
  process.exit(1);
}

const client = new Resend(apiKey);
const { data, error } = await client.emails.send({
  from,
  to,
  subject: `[CourtHive test] ${template} render check`,
  html,
  tags: [{ name: 'category', value: 'smoke-test' }],
});

if (error) {
  console.error('Send failed:', JSON.stringify(error, null, 2));
  process.exit(2);
}

console.log(`Sent. id=${data?.id ?? '(none)'} to=${to} from=${from} template=${template}`);
console.log('Check your inbox (and spam). If nothing arrives in a few minutes:');
console.log('  - Confirm DNS records are verified in Resend dashboard');
console.log('  - Confirm EMAIL_FROM matches a verified sending domain');
