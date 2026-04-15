import { PostgresProvisionerApiKeyStorage } from './postgres-provisioner-api-key.storage';
import { IProvisionerApiKeyStorage } from '../interfaces/provisioner-api-key-storage.interface';

function makeMockPool() {
  return { query: jest.fn() };
}

describe('PostgresProvisionerApiKeyStorage', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let storage: IProvisionerApiKeyStorage;

  beforeEach(() => {
    pool = makeMockPool();
    storage = new PostgresProvisionerApiKeyStorage(pool as any);
  });

  describe('findByKeyHash', () => {
    it('returns key and provisioner info when found', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          key_id: 'k1', provisioner_id: 'p1', api_key_hash: 'hash123', label: 'prod',
          is_active: true, last_used_at: null, created_at: new Date('2026-04-14'), expires_at: null,
          provisioner_name: 'IONSport', provisioner_config: { sso: true },
        }],
      });
      let result: any = await storage.findByKeyHash('hash123');
      expect(result.key.keyId).toBe('k1');
      expect(result.provisionerName).toBe('IONSport');
      expect(result.provisionerConfig).toEqual({ sso: true });
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('k.is_active = true');
      expect(sql).toContain('p.is_active = true');
      expect(sql).toContain('expires_at IS NULL OR k.expires_at > NOW()');
    });

    it('returns null when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.findByKeyHash('nope');
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('inserts and returns the key row', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          key_id: 'new-key', provisioner_id: 'p1', api_key_hash: 'h', label: 'staging',
          is_active: true, last_used_at: null, created_at: new Date('2026-04-14'), expires_at: null,
        }],
      });
      let result: any = await storage.create({
        provisionerId: 'p1', apiKeyHash: 'h', label: 'staging', isActive: true,
      });
      expect(result.keyId).toBe('new-key');
      expect(result.label).toBe('staging');
    });
  });

  describe('revoke', () => {
    it('sets is_active to false', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.revoke('k1');
      expect(result.success).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('is_active = false'),
        ['k1'],
      );
    });
  });

  describe('listByProvisioner', () => {
    it('returns keys ordered by created_at', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { key_id: 'k1', provisioner_id: 'p1', api_key_hash: 'h1', label: 'prod', is_active: true, last_used_at: null, created_at: null, expires_at: null },
          { key_id: 'k2', provisioner_id: 'p1', api_key_hash: 'h2', label: 'staging', is_active: true, last_used_at: null, created_at: null, expires_at: null },
        ],
      });
      let result: any = await storage.listByProvisioner('p1');
      expect(result).toHaveLength(2);
      expect(result[0].keyId).toBe('k1');
    });
  });

  describe('updateLastUsed', () => {
    it('updates last_used_at', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await storage.updateLastUsed('k1');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('last_used_at = NOW()'),
        ['k1'],
      );
    });
  });
});
