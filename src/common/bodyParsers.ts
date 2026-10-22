import { json } from 'body-parser';

/**
 * JSON request-body limits: one for the app, a larger one for the two routes that take whole tournament records.
 *
 * A record is posted whole to `POST /provider-key/tournaments` (ingest, provisioning) and `POST /factory/save`
 * (TMX imports). A TEAM tournament can be several MB even in stored shape, and the app-wide limit exists to keep
 * every OTHER route from accepting bodies of that size, so only these two routes get the larger one.
 *
 * Order matters. body-parser marks a request it has parsed and every later parser skips it, so the route parsers
 * are mounted BEFORE the app-wide one; mounted after, the app-wide parser would reject an import first with a 413.
 * Express matches a `use` path on segment boundaries: `/factory/save` covers `/factory/save` and below, not
 * `/factory/save-status`.
 *
 * `main.ts` and every test that builds an app call `applyBodyParsers`, so a test cannot parse with a limit the
 * server does not use.
 *
 * The import limit is read from `process.env` like `CFS_CORS_ORIGINS` (src/common/cors.ts): it must be in the real
 * process environment (PM2 `ecosystem.config.js` or the shell). A value body-parser cannot read falls back to the
 * APP limit, not the larger default — a misconfiguration fails closed (CA, 2026-10-22) — is logged at boot, and is
 * flagged by the config-readiness check, loudly, without taking the server down.
 */

export const IMPORT_BODY_LIMIT_ENV = 'CFS_IMPORT_BODY_LIMIT';
export const APP_BODY_LIMIT = '8mb';
export const DEFAULT_IMPORT_BODY_LIMIT = '64mb';
export const IMPORT_ROUTES = ['/provider-key/tournaments', '/factory/save'];

// the `bytes` grammar body-parser accepts: a number with an optional unit, case-insensitive
const BYTES_PATTERN = /^\d+(\.\d+)?\s*(b|kb|mb|gb)?$/i;

export type ImportBodyLimit = { limit: string; invalid?: string };

export function resolveImportBodyLimit(raw: string | undefined = process.env[IMPORT_BODY_LIMIT_ENV]): ImportBodyLimit {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { limit: DEFAULT_IMPORT_BODY_LIMIT };
  if (!BYTES_PATTERN.test(trimmed)) return { limit: APP_BODY_LIMIT, invalid: trimmed };
  return { limit: trimmed };
}

type UsesMiddleware = { use: (...args: any[]) => unknown };

export function applyBodyParsers(app: UsesMiddleware, importLimit: string = resolveImportBodyLimit().limit) {
  for (const route of IMPORT_ROUTES) app.use(route, json({ limit: importLimit }));
  app.use(json({ limit: APP_BODY_LIMIT }));
}
