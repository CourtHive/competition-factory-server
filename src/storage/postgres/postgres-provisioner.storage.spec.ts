import { PostgresProvisionerStorage } from './postgres-provisioner.storage';
import { IProvisionerStorage } from '../interfaces/provisioner-storage.interface';

function makeMockPool() {
  return { query: jest.fn(), connect: jest.fn() };
}

function makeMockClient() {
  return { query: jest.fn(), release: jest.fn() };
}

describe('PostgresProvisionerStorage', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let storage: IProvisionerStorage;

  beforeEach(() => {
    pool = makeMockPool();
    storage = new PostgresProvisionerStorage(pool as any);
  });

  describe('getProvisioner', () => {
    it('returns mapped row when found', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ provisioner_id: 'p1', name: 'IONSport', is_active: true, config: { foo: 1 }, created_at: new Date('2026-04-14'), updated_at: new Date('2026-04-14') }],
      });
      let result: any = await storage.getProvisioner('p1');
      expect(result.provisionerId).toBe('p1');
      expect(result.name).toBe('IONSport');
      expect(result.isActive).toBe(true);
      expect(result.config).toEqual({ foo: 1 });
    });

    it('returns null when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.getProvisioner('missing');
      expect(result).toBeNull();
    });
  });

  describe('findByName', () => {
    it('returns provisioner by name', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ provisioner_id: 'p1', name: 'IONSport', is_active: true, config: {}, created_at: null, updated_at: null }],
      });
      let result: any = await storage.findByName('IONSport');
      expect(result.name).toBe('IONSport');
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE name = $1'), ['IONSport']);
    });
  });

  describe('findAll', () => {
    it('returns all provisioners', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { provisioner_id: 'p1', name: 'A', is_active: true, config: {}, created_at: null, updated_at: null },
          { provisioner_id: 'p2', name: 'B', is_active: false, config: {}, created_at: null, updated_at: null },
        ],
      });
      let result: any = await storage.findAll();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('A');
      expect(result[1].isActive).toBe(false);
    });
  });

  describe('create', () => {
    it('inserts and returns the created provisioner', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ provisioner_id: 'new-id', name: 'TestOrg', is_active: true, config: { x: 1 }, created_at: new Date('2026-04-14'), updated_at: new Date('2026-04-14') }],
      });
      let result: any = await storage.create({ name: 'TestOrg', isActive: true, config: { x: 1 } });
      expect(result.provisionerId).toBe('new-id');
      expect(result.name).toBe('TestOrg');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO provisioners'),
        ['TestOrg', true, JSON.stringify({ x: 1 })],
      );
    });
  });

  describe('update', () => {
    it('builds dynamic SET clause for provided fields', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.update('p1', { name: 'NewName', isActive: false });
      expect(result.success).toBe(true);
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('name = $1');
      expect(sql).toContain('is_active = $2');
      expect(sql).toContain('updated_at = NOW()');
    });

    it('returns success when no fields provided', async () => {
      let result: any = await storage.update('p1', {});
      expect(result.success).toBe(true);
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('sets is_active to false', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.deactivate('p1');
      expect(result.success).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('is_active = false'),
        ['p1'],
      );
    });
  });

  describe('deleteWithCascade', () => {
    it('runs cascade in a single transaction and returns row counts', async () => {
      const client = makeMockClient();
      pool.connect.mockResolvedValueOnce(client);
      // BEGIN, then 3 cascade DELETEs (with rowCount), then user_provisioners,
      // then provisioner DELETE, then COMMIT
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 3 }) // provisioner_api_keys
        .mockResolvedValueOnce({ rowCount: 2 }) // provisioner_providers
        .mockResolvedValueOnce({ rowCount: 5 }) // tournament_provisioner
        .mockResolvedValueOnce({ rowCount: 4 }) // user_provisioners
        .mockResolvedValueOnce({ rowCount: 1 }) // provisioners
        .mockResolvedValueOnce({}); // COMMIT

      let result: any = await storage.deleteWithCascade('p1');

      expect(result).toEqual({ apiKeys: 3, providerAssociations: 2, tournamentStamps: 5 });

      const calls = client.query.mock.calls.map((c: any) => c[0]);
      expect(calls[0]).toBe('BEGIN');
      expect(calls[1]).toContain('DELETE FROM provisioner_api_keys');
      expect(calls[2]).toContain('DELETE FROM provisioner_providers');
      expect(calls[3]).toContain('DELETE FROM tournament_provisioner');
      expect(calls[4]).toContain('DELETE FROM user_provisioners');
      expect(calls[5]).toContain('DELETE FROM provisioners');
      expect(calls[6]).toBe('COMMIT');
      expect(client.release).toHaveBeenCalled();
    });

    it('rolls back on error and releases the client', async () => {
      const client = makeMockClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('boom')) // first cascade DELETE fails
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(storage.deleteWithCascade('p1')).rejects.toThrow('boom');

      const calls = client.query.mock.calls.map((c: any) => c[0]);
      expect(calls[0]).toBe('BEGIN');
      expect(calls[calls.length - 1]).toBe('ROLLBACK');
      expect(client.release).toHaveBeenCalled();
    });

    it('returns 0 counts when nothing to cascade (already-empty provisioner)', async () => {
      const client = makeMockClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rowCount: 0 }) // provisioner_api_keys
        .mockResolvedValueOnce({ rowCount: 0 }) // provisioner_providers
        .mockResolvedValueOnce({ rowCount: 0 }) // tournament_provisioner
        .mockResolvedValueOnce({ rowCount: 0 }) // user_provisioners
        .mockResolvedValueOnce({ rowCount: 1 }) // provisioners
        .mockResolvedValueOnce({}); // COMMIT

      let result: any = await storage.deleteWithCascade('p1');
      expect(result).toEqual({ apiKeys: 0, providerAssociations: 0, tournamentStamps: 0 });
    });
  });
});
