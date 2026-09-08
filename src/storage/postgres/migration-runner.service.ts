/**
 * Automatic Postgres schema migration runner.
 *
 * On module init, reads all .sql files from the migrations/ directory,
 * compares them against a `schema_migrations` tracking table, and applies
 * any pending migrations in filename order. Each migration runs inside its
 * own transaction. If any migration fails, the server does NOT start —
 * it's better to fail loudly than to run against a half-migrated schema.
 *
 * Existing migrations (001–003) that were previously applied by hand are
 * detected as already-applied on first run because the SQL files use
 * idempotent DDL (CREATE TABLE IF NOT EXISTS, ALTER TABLE ... ADD COLUMN
 * IF NOT EXISTS). The runner applies them and records them in the tracking
 * table without harm.
 *
 * Only active when STORAGE_PROVIDER=postgres. LevelDB deployments skip
 * the runner entirely.
 */
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { Pool } from 'pg';

import { PG_POOL } from './postgres.config';

// Resolve from __dirname, so the runner works from ANY working directory.
//
// This used to be `join(process.cwd(), 'src', 'storage', 'postgres', 'migrations')` — the SOURCE
// tree, because tsc does not copy .sql files. That made the schema depend on where the process
// happened to be started, and it failed OPEN: `getPendingMigrations` returns [] when the directory
// is missing, so the caller logged "All migrations up to date" over an empty database and exited 0.
// The warning it prints first is immediately contradicted by that line.
//
// It held in production only because the deploy does `cd $SERVER_DIR && pm2 start` and ships the
// source tree. Neither is guaranteed: a container that copies just `build/` — the normal thing for
// a multi-stage image, and exactly what the in-flight cfs.Dockerfile would do — boots against an
// unmigrated database and says it is up to date.
//
// nest-cli.json now copies the .sql files into `build/src/storage/postgres/migrations`, so
// __dirname resolves for the compiled output, and the `src/` path below covers `nest start` /
// `pnpm watch` / vitest, which execute from the TypeScript tree. courthive-query has always done
// it this way.
const BUILT_MIGRATIONS_DIR = join(__dirname, 'migrations');
const SOURCE_MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'storage', 'postgres', 'migrations');

// Arbitrary, stable key for the session-level advisory lock that serialises
// migration application across concurrent runners (parallel test workers, or
// multiple app instances booting at once). Without it, two runners can both
// see a new CREATE TABLE migration pending and race the create, colliding on
// pg_type ("duplicate key value violates unique constraint
// pg_type_typname_nsp_index"). ALTER-only migrations don't create a row type
// so never tripped this — a new-table migration does.
const MIGRATION_ADVISORY_LOCK_KEY = 728041;

@Injectable()
export class MigrationRunnerService implements OnModuleInit {
  private readonly logger = new Logger(MigrationRunnerService.name);
  private readonly pool: Pool;
  private readonly enabled: boolean;

  constructor(@Inject(PG_POOL) pool: Pool | null) {
    this.enabled = pool !== null;
    // Assign a non-null reference so private methods don't need null checks.
    // When pool is null (LevelDB mode), onModuleInit returns early and
    // none of the private methods are ever called.
    this.pool = pool as Pool;
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('Postgres not configured — skipping migrations');
      return;
    }

    await this.ensureTrackingTable();
    await this.withAdvisoryLock(async () => {
      // Re-read applied migrations AFTER acquiring the lock: another runner may
      // have applied the pending set while we were blocked.
      const applied = await this.getAppliedMigrations();
      const pending = await this.getPendingMigrations(applied);

      if (pending.length === 0) {
        this.logger.log('All migrations up to date');
        return;
      }

      this.logger.log(`Applying ${pending.length} pending migration(s)...`);
      for (const migration of pending) {
        await this.applyMigration(migration);
      }
      this.logger.log('All migrations applied successfully');
    });
  }

  /**
   * Run `fn` while holding a session-level Postgres advisory lock so concurrent
   * runners apply migrations one-at-a-time. The lock is acquired and released
   * on the same dedicated connection (advisory locks are session-scoped).
   */
  private async withAdvisoryLock(fn: () => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
      await fn();
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
      } finally {
        client.release();
      }
    }
  }

  private async ensureTrackingTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }

  private async getAppliedMigrations(): Promise<Set<string>> {
    const result = await this.pool.query('SELECT name FROM schema_migrations ORDER BY name');
    return new Set(result.rows.map((row) => row.name));
  }

  /**
   * Locate the migrations directory: the compiled copy first (nest-cli copies the .sql files into
   * build/), then the source tree for `nest start` / `pnpm watch` / vitest.
   *
   * THROWS when neither exists. This used to return [] and let the caller report "All migrations
   * up to date" over an empty database — a fail-open default on the one path whose whole job is to
   * build the schema, where "did nothing" and "succeeded" must never look alike. There is no
   * legitimate state in which a service that ships migrations cannot find them, so this is a
   * startup failure, not a warning.
   */
  private async resolveMigrationsDir(): Promise<string> {
    for (const dir of [BUILT_MIGRATIONS_DIR, SOURCE_MIGRATIONS_DIR]) {
      try {
        await readdir(dir);
        return dir;
      } catch {
        // try the next candidate
      }
    }
    throw new Error(
      `Migrations directory not found. Looked in:\n  ${BUILT_MIGRATIONS_DIR}\n  ${SOURCE_MIGRATIONS_DIR}\n` +
        'Refusing to report success against a database that may be unmigrated. If this is a ' +
        'container image, it must include the .sql files — nest-cli.json copies them into build/.',
    );
  }

  private async getPendingMigrations(applied: Set<string>): Promise<{ name: string; path: string }[]> {
    const migrationsDir = await this.resolveMigrationsDir();
    const files = await readdir(migrationsDir);

    const pending = files
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => !applied.has(f))
      .map((f) => ({ name: f, path: join(migrationsDir, f) }));

    // A directory that exists but holds no .sql at all is the same fail-open shape as a missing
    // one — an empty read that reports as success. Distinguish it from "everything is applied".
    if (!files.some((f) => f.endsWith('.sql'))) {
      throw new Error(`Migrations directory ${migrationsDir} contains no .sql files.`);
    }

    return pending;
  }

  private async applyMigration(migration: { name: string; path: string }): Promise<void> {
    const sql = await readFile(migration.path, 'utf-8');
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [migration.name]);
      await client.query('COMMIT');
      this.logger.log(`Applied: ${migration.name}`);
    } catch (err: any) {
      await client.query('ROLLBACK');
      this.logger.error(`Migration failed: ${migration.name}`, err.stack || err.message);
      throw new Error(`Migration ${migration.name} failed — server cannot start. Fix the migration and restart.`);
    } finally {
      client.release();
    }
  }
}
