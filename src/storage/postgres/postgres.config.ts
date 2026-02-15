export const PG_POOL = Symbol('PG_POOL');

export function getPostgresConfig() {
  return {
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT) || 5432,
    user: process.env.PG_USER || 'courthive',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'courthive',
  };
}
