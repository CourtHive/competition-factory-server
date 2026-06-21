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

// Resolve to the SOURCE migrations directory, not __dirname (which points to
// build/ at runtime — .sql files are not copied by tsc). process.cwd() is the
// project root for both `nest start` and `pnpm watch`.
const MIGRATIONS_DIR = join(process.cwd(), 'src', 'storage', 'postgres', 'migrations');

// Arbitrary, stable key for the session-level advisory lock that serialises
// migration application across concurrent runners (parallel jest workers, or
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

  private async getPendingMigrations(applied: Set<string>): Promise<{ name: string; path: string }[]> {
    let files: string[];
    try {
      files = await readdir(MIGRATIONS_DIR);
    } catch {
      this.logger.warn(`Migrations directory not found: ${MIGRATIONS_DIR}`);
      return [];
    }

    return files
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => !applied.has(f))
      .map((f) => ({ name: f, path: join(MIGRATIONS_DIR, f) }));
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
