import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getPostgresConfig } from 'src/storage/postgres/postgres.config';
import { assertTestDatabase, testDatabaseRefusal, testRunDatabase } from './testDatabaseGuard';
import teardown from './teardown';
import setup from './setup';

// Counts every Pool the setup or teardown would open: a refused run must open none.
const pg = vi.hoisted(() => ({ pools: 0 }));
vi.mock('pg', () => {
  class Pool {
    constructor() {
      pg.pools += 1;
    }
    connect() {
      throw new Error('a refused test run connected to Postgres');
    }
    end() {
      return Promise.resolve();
    }
  }
  return { Pool, default: { Pool } };
});

const KEYS = ['PG_DATABASE', 'PG_HOST', 'STORAGE_PROVIDER'] as const;
let saved: Partial<Record<(typeof KEYS)[number], string>>;

beforeEach(() => {
  saved = {};
  for (const key of KEYS) saved[key] = process.env[key];
  pg.pools = 0;
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('the test database guard', () => {
  it.each(['courthive', 'courthive_dev', 'courthive_prod', 'latest', 'contest', 'circuit', 'testing', 'production'])(
    'refuses %s',
    (name) => {
      expect(testDatabaseRefusal({ PG_DATABASE: name })).toContain(`'${name}'`);
      expect(() => assertTestDatabase({ PG_DATABASE: name })).toThrow(/not named as a test database/);
    },
  );

  it.each(['courthive_test', 'test_courthive', 'cfs-test-1', 'cfs_tests', 'guidon_ci', 'CI_RUN', 'test'])(
    'accepts %s',
    (name) => {
      expect(testDatabaseRefusal({ PG_DATABASE: name })).toBeUndefined();
      expect(() => assertTestDatabase({ PG_DATABASE: name })).not.toThrow();
    },
  );

  it('refuses an unset PG_DATABASE, which falls back to the database the server uses', () => {
    delete process.env.PG_DATABASE;
    // the fallback the guard reads is the server's own, so the two cannot drift apart
    expect(testRunDatabase({})).toEqual(getPostgresConfig().database);
    expect(testDatabaseRefusal({})).toMatch(/PG_DATABASE is unset, so it falls back to 'courthive'/);
    expect(testDatabaseRefusal({ PG_DATABASE: '' })).toMatch(/PG_DATABASE is unset/);
  });

  it('accepts every database the CI workflow runs the suite against', () => {
    const workflow = readFileSync(join(__dirname, '../../../.github/workflows/ci.yml'), 'utf8');
    const databases = [...workflow.matchAll(/^\s*PG_DATABASE:\s*['"]?([^'"\s#]+)/gm)].map((match) => match[1]);
    expect(databases.length).toBeGreaterThan(0);
    for (const database of databases) expect(testDatabaseRefusal({ PG_DATABASE: database })).toBeUndefined();
  });

  it('globalSetup refuses a real database before it connects', async () => {
    process.env.STORAGE_PROVIDER = 'postgres';
    process.env.PG_DATABASE = 'courthive';
    await expect(setup()).rejects.toThrow(/PG_DATABASE is 'courthive'/);
    delete process.env.PG_DATABASE;
    await expect(setup()).rejects.toThrow(/falls back to 'courthive'/);
    expect(pg.pools).toEqual(0);
  });

  it('globalTeardown deletes nothing from a real database', async () => {
    process.env.STORAGE_PROVIDER = 'postgres';
    process.env.PG_HOST = '127.0.0.1';
    process.env.PG_DATABASE = 'courthive';
    await expect(teardown()).resolves.toBeUndefined();
    expect(pg.pools).toEqual(0);
  });
});
