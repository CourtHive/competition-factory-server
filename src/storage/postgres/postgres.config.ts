export const PG_POOL = Symbol('PG_POOL');

// pg waits for a free connection indefinitely by default. A request that needs a second connection while holding the
// first (C1, COMMAND_RECEIPTS.md) then hangs the server with no error; bounded, it fails loudly in the log instead.
const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;

export function getPostgresConfig() {
  return {
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT) || 5432,
    user: process.env.PG_USER || 'courthive',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'courthive',
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS) || DEFAULT_CONNECTION_TIMEOUT_MS,
  };
}
