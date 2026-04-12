import { PostgresBoltHistoryStorage } from './postgres-bolt-history.storage';
import {
  BoltHistoryDocument,
  IBoltHistoryStorage,
  VERSION_CONFLICT,
} from '../interfaces/bolt-history.interface';

const buildDocument = (overrides: Partial<BoltHistoryDocument> = {}): BoltHistoryDocument => ({
  tieMatchUpId: 'tie-1',
  parentMatchUpId: 'parent-1',
  tournamentId: 'tour-1',
  sides: [
    { sideNumber: 1, participant: { participantId: 'p1', participantName: 'Alice' } },
    { sideNumber: 2, participant: { participantId: 'p2', participantName: 'Bob' } },
  ],
  engineState: { score: { sets: [] }, history: { points: [] } },
  boltStarted: false,
  boltExpired: false,
  boltComplete: false,
  timeoutsUsed: { 1: 0, 2: 0 },
  pausedOnExit: false,
  createdAt: '2026-04-10T00:00:00.000Z',
  updatedAt: '2026-04-10T00:00:00.000Z',
  version: 0,
  ...overrides,
});

interface MockClient {
  query: jest.Mock;
  release: jest.Mock;
}

interface MockPool {
  query: jest.Mock;
  connect: jest.Mock;
  __client: MockClient;
}

function makeMockPool(): MockPool {
  const client: MockClient = {
    query: jest.fn(),
    release: jest.fn(),
  };
  const pool: MockPool = {
    query: jest.fn(),
    connect: jest.fn(async () => client),
    __client: client,
  };
  return pool;
}

describe('PostgresBoltHistoryStorage', () => {
  let pool: MockPool;
  let storage: IBoltHistoryStorage;

  beforeEach(() => {
    pool = makeMockPool();
    storage = new PostgresBoltHistoryStorage(pool as any);
  });

  describe('ensureSchema', () => {
    it('runs DDL exactly once across multiple calls', async () => {
      pool.query.mockResolvedValue({ rows: [] }); // for ensureSchema + find
      await storage.findBoltHistory({ tieMatchUpId: 'absent' });
      await storage.findBoltHistory({ tieMatchUpId: 'absent' });
      // 1 ensureSchema DDL + 2 SELECTs = 3 pool.query calls
      expect(pool.query).toHaveBeenCalledTimes(3);
      const ddlCall = pool.query.mock.calls[0][0];
      expect(typeof ddlCall).toBe('string');
      expect(ddlCall).toMatch(/CREATE TABLE IF NOT EXISTS bolt_history/);
    });

    it('throws when pool is null', async () => {
      const nullPoolStorage = new PostgresBoltHistoryStorage(null as any);
      const result = await nullPoolStorage.findBoltHistory({ tieMatchUpId: 'x' });
      expect(result.error).toMatch(/Pool/);
    });
  });

  describe('findBoltHistory', () => {
    it('returns the stored document when present', async () => {
      const doc = buildDocument({ version: 5 });
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // ensureSchema DDL
        .mockResolvedValueOnce({ rows: [{ data: doc }] }); // SELECT
      const result = await storage.findBoltHistory({ tieMatchUpId: 'tie-1' });
      expect(result.document?.version).toBe(5);
    });

    it('returns error when missing', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // ensureSchema
        .mockResolvedValueOnce({ rows: [] }); // SELECT
      const result = await storage.findBoltHistory({ tieMatchUpId: 'tie-1' });
      expect(result.error).toBe('Bolt history not found');
    });
  });

  describe('saveBoltHistory', () => {
    it('inserts a new document with version 1 in a transaction', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // ensureSchema
      const client = pool.__client;
      client.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT FOR UPDATE — no existing
        .mockResolvedValueOnce(undefined) // INSERT
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await storage.saveBoltHistory({ document: buildDocument({ version: 0 }) });
      expect(result.success).toBe(true);
      expect(result.version).toBe(1);
      expect(client.query.mock.calls[0][0]).toBe('BEGIN');
      expect(client.query.mock.calls[2][0]).toMatch(/INSERT INTO bolt_history/);
      expect(client.query.mock.calls[3][0]).toBe('COMMIT');
      expect(client.release).toHaveBeenCalled();
    });

    it('updates an existing document and increments version', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // ensureSchema
      const client = pool.__client;
      client.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ version: 3, created_at: new Date('2026-04-09T00:00:00Z') }] })
        .mockResolvedValueOnce(undefined) // UPDATE
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await storage.saveBoltHistory({ document: buildDocument({ version: 3 }) });
      expect(result.success).toBe(true);
      expect(result.version).toBe(4);
      expect(client.query.mock.calls[2][0]).toMatch(/UPDATE bolt_history/);
    });

    it('returns VERSION_CONFLICT when stored version is ahead', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // ensureSchema
      const client = pool.__client;
      client.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ version: 5, created_at: new Date() }] })
        .mockResolvedValueOnce(undefined); // ROLLBACK

      const result = await storage.saveBoltHistory({ document: buildDocument({ version: 2 }) });
      expect(result.error).toBe(VERSION_CONFLICT);
      expect(client.query.mock.calls[2][0]).toBe('ROLLBACK');
    });

    it('rolls back on query error', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // ensureSchema
      const client = pool.__client;
      client.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined); // ROLLBACK

      const result = await storage.saveBoltHistory({ document: buildDocument() });
      expect(result.error).toMatch(/boom/);
      expect(client.release).toHaveBeenCalled();
    });
  });

  describe('listBoltHistoryForTournament', () => {
    it('returns documents filtered by tournamentId', async () => {
      const docs = [buildDocument({ tieMatchUpId: 'a' }), buildDocument({ tieMatchUpId: 'b' })];
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // ensureSchema
        .mockResolvedValueOnce({ rows: docs.map((data) => ({ data })) }); // SELECT

      const result = await storage.listBoltHistoryForTournament({ tournamentId: 'tour-1' });
      expect(result.documents).toHaveLength(2);
      expect(result.documents?.[0].tieMatchUpId).toBe('a');
    });
  });

  describe('removeBoltHistory', () => {
    it('issues DELETE', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // ensureSchema
        .mockResolvedValueOnce({ rows: [] }); // DELETE
      const result = await storage.removeBoltHistory({ tieMatchUpId: 'tie-1' });
      expect(result.success).toBe(true);
      expect(pool.query.mock.calls[1][0]).toMatch(/DELETE FROM bolt_history/);
    });
  });
});
