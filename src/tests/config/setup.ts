// Jest globalSetup — runs once before the whole suite.
//
// Preflight: `courthive-ingest` is a `link:../courthive-ingest` dependency that
// the server consumes from its `build/` output (build/index.js). During a
// concurrent local rebuild that output can be momentarily inconsistent — e.g.
// index.js emitted but build/core/* not yet — which otherwise surfaces as a
// cryptic per-suite "Cannot find module './core/AdapterRegistry'" load failure.
// Fail fast here with an actionable message instead. CI builds courthive-ingest
// before the server, so this only trips during concurrent local dev builds.
// Schema: apply migrations once, before any spec runs.
//
// MigrationRunnerService normally does this in onModuleInit, so the schema appeared as a
// side-effect of whichever spec first booted AppModule. Specs that talk to Postgres WITHOUT
// booting the app — factory.controller.spec is one — therefore depended on running after one
// that did. On a developer database, already migrated by an earlier run, that dependency is
// invisible. Against a fresh database it is a `42P01 undefined_table` in whichever spec loses
// the ordering, which is exactly what the first CI run on service containers produced.
//
// The real runner is reused rather than reimplemented: a second copy of the migration logic in
// test scaffolding is the mock-divergence trap that architectural-standards.md warns about.
async function applyMigrations() {
  if (process.env.STORAGE_PROVIDER !== 'postgres') return;

  const { MigrationRunnerService } = await import('src/storage/postgres/migration-runner.service');
  const { getPostgresConfig } = await import('src/storage/postgres/postgres.config');
  const { Pool } = await import('pg');

  const pool = new Pool(getPostgresConfig());
  try {
    await new MigrationRunnerService(pool as any).onModuleInit();
  } finally {
    await pool.end();
  }
}

export default async function setup() {
  try {
    await import('courthive-ingest');
  } catch (err: any) {
    if (err?.code === 'MODULE_NOT_FOUND' || err?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        `[test setup] Could not load the 'courthive-ingest' build (${err.message}).\n` +
          `It is a link:../courthive-ingest dependency served from its build/ output, ` +
          `which is stale or mid-rebuild.\n` +
          `Rebuild it, then re-run:  (cd ../courthive-ingest && pnpm build)`,
      );
    }
    throw err;
  }

  await applyMigrations();
}
