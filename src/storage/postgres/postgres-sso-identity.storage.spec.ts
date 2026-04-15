import { PostgresSsoIdentityStorage } from './postgres-sso-identity.storage';
import { ISsoIdentityStorage } from '../interfaces/sso-identity-storage.interface';

function makeMockPool() {
  return { query: jest.fn() };
}

describe('PostgresSsoIdentityStorage', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let storage: ISsoIdentityStorage;

  beforeEach(() => {
    pool = makeMockPool();
    storage = new PostgresSsoIdentityStorage(pool as any);
  });

  describe('findByExternalId', () => {
    it('returns identity when found', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ user_id: 'u1', sso_provider: 'ioncourt', external_id: 'ext-123', phone: '+1-555', email: 'j@x.com', created_at: null }],
      });
      let result: any = await storage.findByExternalId('ioncourt', 'ext-123');
      expect(result.userId).toBe('u1');
      expect(result.ssoProvider).toBe('ioncourt');
      expect(result.externalId).toBe('ext-123');
      expect(result.phone).toBe('+1-555');
    });

    it('returns null when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.findByExternalId('ioncourt', 'missing');
      expect(result).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('returns all SSO identities for a user', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { user_id: 'u1', sso_provider: 'ioncourt', external_id: 'ext-1', phone: null, email: 'a@x.com', created_at: null },
          { user_id: 'u1', sso_provider: 'other', external_id: 'ext-2', phone: null, email: 'a@x.com', created_at: null },
        ],
      });
      let result: any = await storage.findByUserId('u1');
      expect(result).toHaveLength(2);
      expect(result[0].ssoProvider).toBe('ioncourt');
      expect(result[1].ssoProvider).toBe('other');
    });
  });

  describe('create', () => {
    it('inserts a new identity', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.create({
        userId: 'u1', ssoProvider: 'ioncourt', externalId: 'ext-123', phone: '+1-555', email: 'j@x.com',
      });
      expect(result.success).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sso_identities'),
        ['u1', 'ioncourt', 'ext-123', '+1-555', 'j@x.com'],
      );
    });
  });

  describe('update', () => {
    it('updates phone and email', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.update('ioncourt', 'ext-123', { phone: '+1-999', email: 'new@x.com' });
      expect(result.success).toBe(true);
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('phone = $1');
      expect(sql).toContain('email = $2');
    });

    it('returns success with no-op when no fields provided', async () => {
      let result: any = await storage.update('ioncourt', 'ext-123', {});
      expect(result.success).toBe(true);
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the identity', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.remove('ioncourt', 'ext-123');
      expect(result.success).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM sso_identities'),
        ['ioncourt', 'ext-123'],
      );
    });
  });
});
