import { PostgresProviderApiKeyStorage } from './postgres-provider-api-key.storage';
import { IProviderApiKeyStorage } from '../interfaces/provider-api-key-storage.interface';

function makeMockPool() {
  return { query: jest.fn() };
}

describe('PostgresProviderApiKeyStorage', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let storage: IProviderApiKeyStorage;

  beforeEach(() => {
    pool = makeMockPool();
    storage = new PostgresProviderApiKeyStorage(pool as any);
  });

  describe('findByKeyHash', () => {
    it('returns key and provider info when found', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          key_id: 'k1', provider_id: 'kronos', api_key_hash: 'hash123', label: 'prod',
          is_active: true, last_used_at: null, created_at: new Date('2026-04-14'), expires_at: null,
          provider_name: 'Kronos Sports', provider_config: { permissions: {} },
        }],
      });
      let result: any = await storage.findByKeyHash('hash123');
      expect(result.key.keyId).toBe('k1');
      expect(result.providerName).toBe('Kronos Sports');
      expect(result.providerConfig).toEqual({ permissions: {} });
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('k.is_active = true');
      expect(sql).toContain('expires_at IS NULL OR k.expires_at > NOW()');
    });

    it('returns null when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.findByKeyHash('nope');
      expect(result).toBeNull();
    });

    it('defaults missing provider_config to empty object', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          key_id: 'k1', provider_id: 'p1', api_key_hash: 'h', label: null,
          is_active: true, last_used_at: null, created_at: null, expires_at: null,
          provider_name: 'Some Provider', provider_config: null,
        }],
      });
      let result: any = await storage.findByKeyHash('h');
      expect(result.providerConfig).toEqual({});
    });
  });

  describe('create', () => {
    it('inserts and returns the key row', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          key_id: 'new-key', provider_id: 'kronos', api_key_hash: 'h', label: 'staging',
          is_active: true, last_used_at: null, created_at: new Date('2026-04-14'), expires_at: null,
        }],
      });
      let result: any = await storage.create({
        providerId: 'kronos', apiKeyHash: 'h', label: 'staging', isActive: true,
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

  describe('listByProvider', () => {
    it('returns keys ordered by created_at', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { key_id: 'k1', provider_id: 'kronos', api_key_hash: 'h1', label: 'prod', is_active: true, last_used_at: null, created_at: null, expires_at: null },
          { key_id: 'k2', provider_id: 'kronos', api_key_hash: 'h2', label: 'staging', is_active: true, last_used_at: null, created_at: null, expires_at: null },
        ],
      });
      let result: any = await storage.listByProvider('kronos');
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
