/**
 * The test suite writes to Postgres: globalSetup applies migrations, specs that boot AppModule write through to the
 * database, and globalTeardown deletes rows. When `PG_DATABASE` is unset, the server's config falls back to
 * `courthive` (`getPostgresConfig`, `StorageConfig`), and a developer `.env` usually names that same database. A test
 * run on a machine that holds a real database would then migrate it, write to it and delete from it.
 *
 * So the suite refuses to start unless the database it would use is named as a test database: its name contains
 * `test`, `tests` or `ci` as a whole word, delimited by the start or end of the name, `_` or `-` (`courthive_test`,
 * `cfs-test-1`, `guidon_ci`). `courthive`, `courthive_dev` and `latest` are refused. There is no override: create a
 * database with a test name and point `PG_DATABASE` at it.
 */

/** The environment a test run reads its database from. */
type TestEnv = Record<string, string | undefined>;

/** A database name that is clearly a test one. */
export const TEST_DATABASE_PATTERN = /(?:^|[_-])(?:test|tests|ci)(?:$|[_-])/i;

/** The database the server connects to when `PG_DATABASE` is unset (`getPostgresConfig`, `StorageConfig`). */
const FALLBACK_DATABASE = 'courthive';

/** The database a test run would use under `env`. */
export function testRunDatabase(env: TestEnv = process.env): string {
  return env.PG_DATABASE || FALLBACK_DATABASE;
}

/** Why a test run under `env` must not start, or undefined when its database is a test one. */
export function testDatabaseRefusal(env: TestEnv = process.env): string | undefined {
  const database = testRunDatabase(env);
  if (TEST_DATABASE_PATTERN.test(database)) return undefined;
  const source = env.PG_DATABASE
    ? `PG_DATABASE is '${database}'`
    : `PG_DATABASE is unset, so it falls back to '${database}'`;
  return (
    `Refusing to run the test suite: ${source}, which is not named as a test database. ` +
    `The suite migrates, writes to and deletes from the database it uses. Create a test database and point ` +
    `PG_DATABASE at it, for example: createdb courthive_test && PG_DATABASE=courthive_test pnpm test. ` +
    `A test database name contains test, tests or ci as a whole word (${TEST_DATABASE_PATTERN}).`
  );
}

/** Throw unless the database a test run under `env` would use is a test one. */
export function assertTestDatabase(env: TestEnv = process.env): void {
  const refusal = testDatabaseRefusal(env);
  if (refusal) throw new Error(refusal);
}
