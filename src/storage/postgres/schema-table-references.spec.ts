/**
 * Guard: every table named in the provider-lifecycle raw SQL must still exist
 * after all migrations have been applied.
 *
 * The provider archive / cleanup / revive path is the one place in CFS that
 * addresses tables by hand-written SQL string rather than through a storage
 * interface, and it has no runtime coverage — a `DELETE FROM <dropped table>`
 * only fails when an operator archives a provider, long after the migration
 * that removed the table shipped. Migration 041 (dropping `official_records`
 * and `sanctioning_records`, which AMS owns) is exactly that shape of change,
 * so the relationship gets a test rather than a comment.
 *
 * The live table set is derived by replaying every migration's CREATE TABLE /
 * DROP TABLE in filename order, which is the order the runner applies them in.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, 'migrations');
const REPO_SRC = join(__dirname, '..', '..');

// The files that address Postgres tables by raw SQL string. Each entry is
// relative to src/.
const RAW_SQL_FILES = [
  'modules/providers/provider-archive.service.ts',
  'modules/providers/provider-cleanup.service.ts',
  'scripts/revive-provider.mjs',
];

// Created by MigrationRunnerService itself before any migration runs, so it
// never appears in a migration file.
const RUNTIME_CREATED_TABLES = new Set(['schema_migrations']);

const stripSqlComments = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

/** Replay every migration in apply order to get the tables that survive. */
function liveTables(): Set<string> {
  const tables = new Set(RUNTIME_CREATED_TABLES);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  for (const file of files) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
      tables.add(match[1].toLowerCase());
    }
    for (const match of sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
      tables.delete(match[1].toLowerCase());
    }
  }
  return tables;
}

/**
 * Table names a source file addresses. Covers the SQL keywords the lifecycle
 * path actually uses plus the one dynamic call site (`insertRows(client,
 * '<table>', rows)` in revive-provider), whose table name is a string literal.
 * CTE names declared in the same file are excluded — they are query-local.
 */
function referencedTables(source: string): Set<string> {
  const ctes = new Set([...source.matchAll(/WITH\s+([a-z_][a-z0-9_]*)\s+AS/gi)].map((match) => match[1].toLowerCase()));
  const referenced = new Set<string>();
  for (const match of source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/g)) {
    referenced.add(match[1]);
  }
  for (const match of source.matchAll(/insertRows\(client,\s*'([a-z_][a-z0-9_]*)'/g)) {
    referenced.add(match[1]);
  }
  for (const cte of ctes) referenced.delete(cte);
  return referenced;
}

describe('provider-lifecycle raw SQL table references', () => {
  const tables = liveTables();

  it('derives the live table set from the migrations, honouring drops', () => {
    // Sanity-check the extractor itself: a created-and-never-dropped table is
    // present, and both tables dropped by shipped migrations are absent. If
    // this ever inverts, every assertion below is meaningless.
    expect(tables.has('providers')).toBe(true);
    expect(tables.has('official_records')).toBe(false);
    expect(tables.has('sanctioning_records')).toBe(false);
    expect(tables.has('bolt_history')).toBe(false);
  });

  it.each(RAW_SQL_FILES)('%s references only tables that exist', (relPath) => {
    const source = readFileSync(join(REPO_SRC, relPath), 'utf8');
    const referenced = [...referencedTables(source)];

    // Guard the guard: a file that suddenly parses to nothing would pass
    // vacuously. Each of these files addresses a dozen tables.
    expect(referenced.length).toBeGreaterThan(5);

    const unknown = referenced.filter((table) => !tables.has(table)).sort((a, b) => a.localeCompare(b, 'en'));
    expect(unknown).toEqual([]);
  });
});
