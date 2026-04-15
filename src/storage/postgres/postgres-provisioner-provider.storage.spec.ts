import { PostgresProvisionerProviderStorage } from './postgres-provisioner-provider.storage';
import { IProvisionerProviderStorage } from '../interfaces/provisioner-provider-storage.interface';

function makeMockPool() {
  return { query: jest.fn() };
}

describe('PostgresProvisionerProviderStorage', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let storage: IProvisionerProviderStorage;

  beforeEach(() => {
    pool = makeMockPool();
    storage = new PostgresProvisionerProviderStorage(pool as any);
  });

  describe('findByProvisioner', () => {
    it('returns provider associations', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { provisioner_id: 'p1', provider_id: 'prov-a', relationship: 'owner', granted_by: null, created_at: null },
          { provisioner_id: 'p1', provider_id: 'prov-b', relationship: 'subsidiary', granted_by: 'p2', created_at: null },
        ],
      });
      let result: any = await storage.findByProvisioner('p1');
      expect(result).toHaveLength(2);
      expect(result[0].relationship).toBe('owner');
      expect(result[1].grantedBy).toBe('p2');
    });
  });

  describe('findByProvider', () => {
    it('returns provisioner associations for a provider', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ provisioner_id: 'p1', provider_id: 'prov-a', relationship: 'owner', granted_by: null, created_at: null }],
      });
      let result: any = await storage.findByProvider('prov-a');
      expect(result).toHaveLength(1);
      expect(result[0].provisionerId).toBe('p1');
    });
  });

  describe('getRelationship', () => {
    it('returns relationship type', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ relationship: 'owner' }] });
      let result: any = await storage.getRelationship('p1', 'prov-a');
      expect(result).toBe('owner');
    });

    it('returns null when no association', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.getRelationship('p1', 'prov-x');
      expect(result).toBeNull();
    });
  });

  describe('associate', () => {
    it('inserts with upsert on conflict', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.associate('p1', 'prov-a', 'owner');
      expect(result.success).toBe(true);
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('INSERT INTO provisioner_providers');
      expect(sql).toContain('ON CONFLICT');
    });

    it('passes grantedBy when provided', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await storage.associate('p2', 'prov-a', 'subsidiary', 'p1');
      expect(pool.query.mock.calls[0][1]).toEqual(['p2', 'prov-a', 'subsidiary', 'p1']);
    });
  });

  describe('updateRelationship', () => {
    it('updates relationship column', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.updateRelationship('p1', 'prov-a', 'subsidiary');
      expect(result.success).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SET relationship = $1'),
        ['subsidiary', 'p1', 'prov-a'],
      );
    });
  });

  describe('disassociate', () => {
    it('deletes the association', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.disassociate('p1', 'prov-a');
      expect(result.success).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM provisioner_providers'),
        ['p1', 'prov-a'],
      );
    });
  });
});
