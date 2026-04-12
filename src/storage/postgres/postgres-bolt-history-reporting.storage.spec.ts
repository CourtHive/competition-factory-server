import { PostgresBoltHistoryReportingStorage } from './postgres-bolt-history-reporting.storage';

interface MockPool {
  query: jest.Mock;
}

function makeMockPool(): MockPool {
  return { query: jest.fn() };
}

describe('PostgresBoltHistoryReportingStorage', () => {
  let pool: MockPool;
  let reporting: PostgresBoltHistoryReportingStorage;

  beforeEach(() => {
    pool = makeMockPool();
    reporting = new PostgresBoltHistoryReportingStorage(pool as any);
  });

  describe('getPlayerPointStats', () => {
    it('runs the participant filter and points aggregation queries', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '3' }] }) // matchUps participated
        .mockResolvedValueOnce({ rows: [{ points_won: '12', points_played: '20' }] }); // points

      const result = await reporting.getPlayerPointStats({
        participantId: 'p1',
        tournamentId: 'tour-1',
      });

      expect(result.stats).toEqual({
        participantId: 'p1',
        pointsWon: 12,
        pointsPlayed: 20,
        winRate: 0.6,
        matchUpsParticipated: 3,
      });

      // First query is the matchUp count
      expect(pool.query.mock.calls[0][0]).toMatch(/COUNT\(\*\) AS count FROM bolt_history/);
      // Second query is the JSONB unroll over points
      expect(pool.query.mock.calls[1][0]).toMatch(/jsonb_array_elements/);
    });

    it('returns winRate=0 when pointsPlayed is 0', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [{ points_won: '0', points_played: '0' }] });

      const result = await reporting.getPlayerPointStats({ participantId: 'p1' });
      expect(result.stats?.winRate).toBe(0);
    });

    it('rejects empty participantId', async () => {
      const result = await reporting.getPlayerPointStats({ participantId: '' });
      expect(result.error).toMatch(/participantId/);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns error when pool is null', async () => {
      const nullPool = new PostgresBoltHistoryReportingStorage(null as any);
      const result = await nullPool.getPlayerPointStats({ participantId: 'p1' });
      expect(result.error).toMatch(/Pool/);
    });

    it('returns error message when query fails', async () => {
      pool.query.mockRejectedValueOnce(new Error('connection lost'));
      const result = await reporting.getPlayerPointStats({ participantId: 'p1' });
      expect(result.error).toMatch(/connection lost/);
    });
  });

  describe('getTournamentLeaders', () => {
    it('returns mapped leaders from the CTE query', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { participant_id: 'p1', participant_name: 'Alice', points_won: '15', matchups: '2' },
          { participant_id: 'p2', participant_name: 'Bob', points_won: '8', matchups: '2' },
        ],
      });

      const result = await reporting.getTournamentLeaders({ tournamentId: 'tour-1' });
      expect(result.leaders).toHaveLength(2);
      expect(result.leaders?.[0]).toEqual({
        participantId: 'p1',
        participantName: 'Alice',
        pointsWon: 15,
        matchUpsParticipated: 2,
      });
      // Default limit is 10
      expect(pool.query.mock.calls[0][1]).toEqual(['tour-1', 10]);
    });

    it('caps the limit between 1 and 100', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await reporting.getTournamentLeaders({ tournamentId: 'tour-1', limit: 0 });
      expect(pool.query.mock.calls[0][1][1]).toBe(1);

      await reporting.getTournamentLeaders({ tournamentId: 'tour-1', limit: 9999 });
      expect(pool.query.mock.calls[1][1][1]).toBe(100);
    });

    it('rejects empty tournamentId', async () => {
      const result = await reporting.getTournamentLeaders({ tournamentId: '' });
      expect(result.error).toMatch(/tournamentId/);
    });

    it('returns error when pool is null', async () => {
      const nullPool = new PostgresBoltHistoryReportingStorage(null as any);
      const result = await nullPool.getTournamentLeaders({ tournamentId: 'tour-1' });
      expect(result.error).toMatch(/Pool/);
    });
  });
});
