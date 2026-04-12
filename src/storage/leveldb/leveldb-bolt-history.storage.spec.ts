import { LeveldbBoltHistoryStorage } from './leveldb-bolt-history.storage';
import {
  BoltHistoryDocument,
  IBoltHistoryStorage,
  VERSION_CONFLICT,
} from '../interfaces/bolt-history.interface';

jest.mock('src/services/levelDB/netLevel', () => {
  const store = new Map<string, any>();
  return {
    __esModule: true,
    default: {
      get: jest.fn(async (_base: string, { key }: { key: string }) => store.get(key) ?? null),
      set: jest.fn(async (_base: string, { key, value }: { key: string; value: any }) => {
        store.set(key, value);
        return { success: true };
      }),
      delete: jest.fn(async (_base: string, { key }: { key: string }) => {
        store.delete(key);
        return { success: true };
      }),
      list: jest.fn(async () =>
        Array.from(store.entries()).map(([key, value]) => ({ key, value })),
      ),
      __reset: () => store.clear(),
    },
  };
});

import netLevelMock from 'src/services/levelDB/netLevel';

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

describe('LeveldbBoltHistoryStorage', () => {
  let storage: IBoltHistoryStorage;

  beforeEach(() => {
    (netLevelMock as any).__reset();
    storage = new LeveldbBoltHistoryStorage();
  });

  describe('saveBoltHistory', () => {
    it('inserts a new document with version 1', async () => {
      const result = await storage.saveBoltHistory({ document: buildDocument() });
      expect(result.success).toBe(true);
      expect(result.version).toBe(1);
    });

    it('increments version on subsequent saves', async () => {
      await storage.saveBoltHistory({ document: buildDocument({ version: 0 }) });
      const second = await storage.saveBoltHistory({ document: buildDocument({ version: 1 }) });
      expect(second.version).toBe(2);
    });

    it('returns VERSION_CONFLICT when stored version is ahead', async () => {
      await storage.saveBoltHistory({ document: buildDocument({ version: 0 }) });
      // Stored is now version 1. Submit a stale document claiming version 0.
      const stale = await storage.saveBoltHistory({ document: buildDocument({ version: 0 }) });
      expect(stale.error).toBe(VERSION_CONFLICT);
    });

    it('rejects documents missing tieMatchUpId', async () => {
      const result = await storage.saveBoltHistory({ document: buildDocument({ tieMatchUpId: '' }) });
      expect(result.error).toMatch(/tieMatchUpId/);
    });
  });

  describe('findBoltHistory', () => {
    it('returns the stored document', async () => {
      await storage.saveBoltHistory({ document: buildDocument() });
      const result = await storage.findBoltHistory({ tieMatchUpId: 'tie-1' });
      expect(result.document?.tieMatchUpId).toBe('tie-1');
      expect(result.document?.version).toBe(1);
    });

    it('returns error when not found', async () => {
      const result = await storage.findBoltHistory({ tieMatchUpId: 'missing' });
      expect(result.error).toBe('Bolt history not found');
    });
  });

  describe('listBoltHistoryForTournament', () => {
    it('filters by tournamentId', async () => {
      await storage.saveBoltHistory({ document: buildDocument({ tieMatchUpId: 'a', tournamentId: 'tour-1' }) });
      await storage.saveBoltHistory({ document: buildDocument({ tieMatchUpId: 'b', tournamentId: 'tour-2' }) });
      await storage.saveBoltHistory({ document: buildDocument({ tieMatchUpId: 'c', tournamentId: 'tour-1' }) });

      const result = await storage.listBoltHistoryForTournament({ tournamentId: 'tour-1' });
      expect(result.documents).toHaveLength(2);
      expect(result.documents?.map((d) => d.tieMatchUpId).sort()).toEqual(['a', 'c']);
    });
  });

  describe('removeBoltHistory', () => {
    it('removes the stored document', async () => {
      await storage.saveBoltHistory({ document: buildDocument() });
      await storage.removeBoltHistory({ tieMatchUpId: 'tie-1' });
      const result = await storage.findBoltHistory({ tieMatchUpId: 'tie-1' });
      expect(result.error).toBe('Bolt history not found');
    });
  });
});
