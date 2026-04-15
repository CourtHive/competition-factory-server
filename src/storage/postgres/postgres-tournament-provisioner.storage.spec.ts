import { PostgresTournamentProvisionerStorage } from './postgres-tournament-provisioner.storage';
import { ITournamentProvisionerStorage } from '../interfaces/tournament-provisioner-storage.interface';

function makeMockPool() {
  return { query: jest.fn() };
}

describe('PostgresTournamentProvisionerStorage', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let storage: ITournamentProvisionerStorage;

  beforeEach(() => {
    pool = makeMockPool();
    storage = new PostgresTournamentProvisionerStorage(pool as any);
  });

  describe('getByTournament', () => {
    it('returns the provisioner mapping when found', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ tournament_id: 't1', provisioner_id: 'p1', provider_id: 'prov-a', created_at: new Date('2026-04-14') }],
      });
      let result: any = await storage.getByTournament('t1');
      expect(result.tournamentId).toBe('t1');
      expect(result.provisionerId).toBe('p1');
    });

    it('returns null when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.getByTournament('missing');
      expect(result).toBeNull();
    });
  });

  describe('getByProvisioner', () => {
    it('returns all tournaments for a provisioner', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { tournament_id: 't1', provisioner_id: 'p1', provider_id: 'prov-a', created_at: null },
          { tournament_id: 't2', provisioner_id: 'p1', provider_id: 'prov-a', created_at: null },
        ],
      });
      let result: any = await storage.getByProvisioner('p1');
      expect(result).toHaveLength(2);
    });

    it('filters by providerId when given', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await storage.getByProvisioner('p1', 'prov-a');
      expect(pool.query.mock.calls[0][1]).toEqual(['p1', 'prov-a']);
      expect(pool.query.mock.calls[0][0]).toContain('provider_id = $2');
    });
  });

  describe('create', () => {
    it('inserts with ON CONFLICT DO NOTHING', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.create({ tournamentId: 't1', provisionerId: 'p1', providerId: 'prov-a' });
      expect(result.success).toBe(true);
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('INSERT INTO tournament_provisioner');
      expect(sql).toContain('ON CONFLICT');
    });
  });

  describe('remove', () => {
    it('deletes the mapping', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.remove('t1');
      expect(result.success).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM tournament_provisioner'),
        ['t1'],
      );
    });
  });
});
