import { BoltHistoryDocument } from '../interfaces/bolt-history.interface';

jest.mock('src/services/levelDB/netLevel', () => {
  const store = new Map<string, any>();
  return {
    __esModule: true,
    default: {
      list: jest.fn(async () =>
        Array.from(store.entries()).map(([key, value]) => ({ key, value })),
      ),
      __seed: (docs: BoltHistoryDocument[]) => {
        store.clear();
        for (const doc of docs) store.set(doc.tieMatchUpId, doc);
      },
    },
  };
});

import netLevelMock from 'src/services/levelDB/netLevel';
import { LeveldbBoltHistoryReportingStorage } from './leveldb-bolt-history-reporting.storage';

const buildDocument = (overrides: Partial<BoltHistoryDocument> = {}): BoltHistoryDocument => ({
  tieMatchUpId: 'tie-1',
  parentMatchUpId: 'parent-1',
  tournamentId: 'tour-1',
  sides: [
    { sideNumber: 1, participant: { participantId: 'p1', participantName: 'Alice' } },
    { sideNumber: 2, participant: { participantId: 'p2', participantName: 'Bob' } },
  ],
  engineState: {
    history: {
      points: [
        { winnerParticipantId: 'p1' },
        { winnerParticipantId: 'p1' },
        { winnerParticipantId: 'p2' },
      ],
    },
  },
  boltStarted: true,
  boltExpired: false,
  boltComplete: false,
  timeoutsUsed: { 1: 0, 2: 0 },
  pausedOnExit: false,
  createdAt: '2026-04-10T00:00:00.000Z',
  updatedAt: '2026-04-10T00:00:00.000Z',
  version: 1,
  ...overrides,
});

describe('LeveldbBoltHistoryReportingStorage', () => {
  let reporting: LeveldbBoltHistoryReportingStorage;

  beforeEach(() => {
    reporting = new LeveldbBoltHistoryReportingStorage();
  });

  describe('getPlayerPointStats', () => {
    it('returns zeros when participant has no documents', async () => {
      (netLevelMock as any).__seed([]);
      const result = await reporting.getPlayerPointStats({ participantId: 'p1' });
      expect(result.stats).toEqual({
        participantId: 'p1',
        pointsWon: 0,
        pointsPlayed: 0,
        winRate: 0,
        matchUpsParticipated: 0,
      });
    });

    it('aggregates points across all matchUps for a participant', async () => {
      (netLevelMock as any).__seed([
        buildDocument({ tieMatchUpId: 'a' }),
        buildDocument({
          tieMatchUpId: 'b',
          engineState: {
            history: {
              points: [
                { winnerParticipantId: 'p1' },
                { winnerParticipantId: 'p2' },
                { winnerParticipantId: 'p2' },
                { winnerParticipantId: 'p1' },
              ],
            },
          },
        }),
      ]);

      const result = await reporting.getPlayerPointStats({ participantId: 'p1' });
      expect(result.stats?.pointsWon).toBe(4);
      expect(result.stats?.pointsPlayed).toBe(7);
      expect(result.stats?.matchUpsParticipated).toBe(2);
      expect(result.stats?.winRate).toBeCloseTo(4 / 7);
    });

    it('filters by tournamentId', async () => {
      (netLevelMock as any).__seed([
        buildDocument({ tieMatchUpId: 'a', tournamentId: 'tour-1' }),
        buildDocument({ tieMatchUpId: 'b', tournamentId: 'tour-2' }),
      ]);
      const result = await reporting.getPlayerPointStats({
        participantId: 'p1',
        tournamentId: 'tour-1',
      });
      expect(result.stats?.matchUpsParticipated).toBe(1);
    });

    it('rejects empty participantId', async () => {
      const result = await reporting.getPlayerPointStats({ participantId: '' });
      expect(result.error).toMatch(/participantId/);
    });
  });

  describe('getTournamentLeaders', () => {
    it('returns leaders sorted by pointsWon descending', async () => {
      (netLevelMock as any).__seed([
        buildDocument({ tieMatchUpId: 'a' }),
        buildDocument({
          tieMatchUpId: 'b',
          engineState: {
            history: {
              points: [
                { winnerParticipantId: 'p2' },
                { winnerParticipantId: 'p2' },
                { winnerParticipantId: 'p2' },
              ],
            },
          },
        }),
      ]);

      const result = await reporting.getTournamentLeaders({ tournamentId: 'tour-1' });
      expect(result.leaders).toHaveLength(2);
      expect(result.leaders?.[0].participantId).toBe('p2');
      expect(result.leaders?.[0].pointsWon).toBe(4);
      expect(result.leaders?.[1].participantId).toBe('p1');
      expect(result.leaders?.[1].pointsWon).toBe(2);
    });

    it('respects the limit parameter', async () => {
      (netLevelMock as any).__seed([buildDocument()]);
      const result = await reporting.getTournamentLeaders({ tournamentId: 'tour-1', limit: 1 });
      expect(result.leaders).toHaveLength(1);
    });

    it('rejects empty tournamentId', async () => {
      const result = await reporting.getTournamentLeaders({ tournamentId: '' });
      expect(result.error).toMatch(/tournamentId/);
    });
  });
});
