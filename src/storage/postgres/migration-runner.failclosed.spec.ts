import { MigrationRunnerService } from './migration-runner.service';
import { Logger } from '@nestjs/common';

// F2 — the runner used to FAIL OPEN.
//
// `MIGRATIONS_DIR` was `join(process.cwd(), 'src', 'storage', 'postgres', 'migrations')`, evaluated
// at module load, and `getPendingMigrations` returned [] when that directory was missing. So a
// process started from anywhere but the repo root logged
//
//   WARN  Migrations directory not found: /elsewhere/src/storage/postgres/migrations
//   LOG   All migrations up to date
//
// and exited 0 against an empty database. It held in production only because the deploy does
// `cd $SERVER_DIR && pm2 start` and ships the source tree — neither of which a container image
// built from `build/` would do.
//
// These live in their own file because `vi.mock('fs/promises')` is hoisted to the whole module and
// the sibling spec needs the real `readdir`.
//
// Both fail against the previous implementation, which swallowed the error and returned [].

const readdirMock = vi.hoisted(() => vi.fn());

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, readdir: readdirMock, readFile: actual.readFile };
});

function poolStub() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  } as any;
}

describe('MigrationRunnerService — fails closed when it cannot find its migrations', () => {
  let logSpies: any[];

  beforeAll(() => {
    logSpies = (['log', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(Logger.prototype, method).mockImplementation(() => undefined),
    );
  });

  afterAll(() => {
    for (const spy of logSpies) spy.mockRestore();
  });

  // Block body, deliberately. `beforeEach(() => readdirMock.mockReset())` returns the mock, and
  // Vitest treats a function returned from a hook as a TEARDOWN callback — so it invoked the mock
  // after every test, producing an uncaught `Promise.reject` that was reported as a failure of the
  // test that had just passed.
  beforeEach(() => {
    readdirMock.mockReset();
  });

  it('throws rather than reporting success when no candidate directory exists', async () => {
    readdirMock.mockImplementation(() => Promise.reject(new Error('ENOENT')));

    let thrown: Error | undefined;
    try {
      await new MigrationRunnerService(poolStub()).onModuleInit();
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toMatch(/Migrations directory not found/);
  });

  it('names both candidate paths in the error, so an operator can see where it looked', async () => {
    readdirMock.mockImplementation(() => Promise.reject(new Error('ENOENT')));

    let thrown: Error | undefined;
    try {
      await new MigrationRunnerService(poolStub()).onModuleInit();
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toMatch(/storage[/\\]postgres[/\\]migrations/);
  });

  it('throws when the directory exists but holds no .sql files', async () => {
    // The same fail-open shape wearing a different hat: an empty read reported as success.
    readdirMock.mockResolvedValue(['README.md'] as any);

    await expect(new MigrationRunnerService(poolStub()).onModuleInit()).rejects.toThrow(/no \.sql files/);
  });

  it('resolves the directory without consulting the working directory', async () => {
    // The defect was cwd-relative resolution. Resolution is now relative to __dirname, so the
    // runner must find its files with the process rooted somewhere else entirely.
    readdirMock.mockResolvedValue(['001-initial-schema.sql'] as any);
    const original = process.cwd();
    try {
      process.chdir('/');
      await expect(new MigrationRunnerService(poolStub()).onModuleInit()).resolves.toBeUndefined();
      expect(readdirMock).toHaveBeenCalled();
    } finally {
      process.chdir(original);
    }
  });
});
