/**
 * EJS template renderer for outbound email.
 *
 * Templates live at `src/email-templates/<name>.ejs` and are loaded
 * relative to the build output. `renderEmail(name, data)` returns the
 * rendered HTML string.
 *
 * Why a tiny wrapper rather than calling ejs directly at every caller:
 * keeps the template-resolution path (build vs source, future
 * relocation to a CDN/S3 bucket) behind one function. When the account
 * module eventually lifts out, we can swap this for an HTTP fetch from
 * a templates CDN without changing the EmailService call sites.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import ejs from 'ejs';

// Templates are co-located with this file at `./templates/<name>.ejs`.
// nest-cli's `assets` config copies them under the same module path
// into build/, so the lookup is identical in dev and prod.
function templatesDir(): string {
  return join(__dirname, 'templates');
}

const templateCache = new Map<string, string>();

function loadTemplate(name: string): string {
  const cached = templateCache.get(name);
  if (cached) return cached;
  const path = join(templatesDir(), `${name}.ejs`);
  const raw = readFileSync(path, 'utf8');
  templateCache.set(name, raw);
  return raw;
}

export function renderEmail(name: string, data: Record<string, unknown>): string {
  const raw = loadTemplate(name);
  return ejs.render(raw, data, { async: false });
}
