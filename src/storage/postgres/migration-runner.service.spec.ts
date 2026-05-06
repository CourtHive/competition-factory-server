import { MigrationRunnerService } from './migration-runner.service';
import { readdirSync } from 'fs';
import { join } from 'path';

// Derive the "all applied" fixture from the migrations directory at test
// load time so adding a new migration .sql file does not invalidate this
// spec. The runner reads from the same directory, so the two stay in sync.
const ALL_DISK_MIGRATIONS = readdirSync(join(__dirname, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();

describe('MigrationRunnerService', () => {
  let service: MigrationRunnerService;
  let mockPool: any;
  let queryResults: any[];

  beforeEach(() => {
    queryResults = [];
    mockPool = {
      query: jest.fn().mockImplementation(() => {
        const result = queryResults.shift() || { rows: [] };
        return Promise.resolve(result);
      }),
      connect: jest.fn().mockResolvedValue({
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      }),
    };
  });

  it('skips when pool is null (LevelDB mode)', async () => {
    service = new MigrationRunnerService(null);
    await service.onModuleInit();
    // Should not throw — just logs and returns
  });

  it('creates schema_migrations table on init', async () => {
    // Return empty applied set
    queryResults = [
      undefined, // CREATE TABLE schema_migrations
      { rows: [] }, // SELECT name FROM schema_migrations
    ];
    service = new MigrationRunnerService(mockPool);
    await service.onModuleInit();
    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('schema_migrations'));
  });

  it('reports all migrations up to date when all are applied', async () => {
    queryResults = [
      undefined, // CREATE TABLE
      { rows: ALL_DISK_MIGRATIONS.map((name) => ({ name })) },
    ];
    service = new MigrationRunnerService(mockPool);
    await service.onModuleInit();
    // Should not call connect() for any migration
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('applies pending migrations in order', async () => {
    const appliedSql: string[] = [];
    const mockClient = {
      query: jest.fn().mockImplementation((sql: string) => {
        appliedSql.push(sql);
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);

    queryResults = [
      undefined, // CREATE TABLE
      { rows: [
        { name: '001-initial-schema.sql' },
        { name: '002-add-last-access.sql' },
        { name: '003-add-bolt-history.sql' },
      ]},
    ];
    service = new MigrationRunnerService(mockPool);
    await service.onModuleInit();

    // Should have connected for each pending migration (004-007)
    expect(mockPool.connect).toHaveBeenCalled();
    // Each migration runs: BEGIN, SQL content, INSERT tracking row, COMMIT
    const beginCount = appliedSql.filter(s => s === 'BEGIN').length;
    const commitCount = appliedSql.filter(s => s === 'COMMIT').length;
    expect(beginCount).toBeGreaterThanOrEqual(1);
    expect(commitCount).toEqual(beginCount);
  });

  it('rolls back and throws on migration failure', async () => {
    const mockClient = {
      query: jest.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('syntax error')), // SQL content fails
      release: jest.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);

    queryResults = [
      undefined, // CREATE TABLE
      { rows: [] }, // no applied migrations
    ];
    service = new MigrationRunnerService(mockPool);

    await expect(service.onModuleInit()).rejects.toThrow('failed');
    // Should have attempted ROLLBACK
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});
