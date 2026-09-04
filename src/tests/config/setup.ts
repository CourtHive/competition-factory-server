// Vitest globalSetup — runs once before the whole suite.
//
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
  await applyMigrations();
}
