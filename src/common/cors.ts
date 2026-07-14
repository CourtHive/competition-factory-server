/**
 * Resolve a CORS `origin` option from a comma-separated env allowlist.
 *
 * - Unset / empty / `*`  → `'*'` (permissive). Preserves the historical
 *   behavior so nothing regresses until an operator opts in, and keeps local
 *   dev and public fan embeds working out of the box.
 * - Comma-separated list → an exact-match allowlist. The `cors` package (and
 *   Socket.IO, which delegates to it) reflects the request `Origin` only when
 *   it appears in the array and blocks the preflight otherwise.
 *
 * Reads `process.env` directly rather than through Nest's ConfigService so the
 * same helper works both in `bootstrap()` (HTTP CORS) AND inside
 * `@WebSocketGateway()` decorators, which are evaluated at class-definition
 * (import) time — before ConfigModule initializes. The consequence: these vars
 * must be present in the real process environment (PM2 `ecosystem.config.js` or
 * the shell), the same contract as `NODE_ENV` / `APP_MODE` in `main.ts`. A
 * value that only lives in a dotenv `.env` file may not be loaded yet when a
 * gateway decorator runs — which is safe here because the unset default is `*`.
 *
 * CFS uses Bearer tokens, not cookies, so it never sets `credentials: true`;
 * therefore the `*` default is valid (the `*`-with-credentials restriction
 * does not apply).
 */
export function resolveCorsOrigins(raw: string | undefined): string[] | '*' {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed === '*') return '*';
  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
