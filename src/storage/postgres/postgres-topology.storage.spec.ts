import { PostgresTopologyStorage } from './postgres-topology.storage';
import { ITopologyStorage } from '../interfaces/topology-storage.interface';

function makeMockPool() {
  return { query: jest.fn() };
}

const NOW = new Date('2026-05-01');
const SAMPLE_ROW = {
  topology_id: 't1',
  provider_id: 'prov1',
  name: 'My Bracket',
  description: 'Custom bracket',
  state: { nodes: [], edges: [] },
  created_at: NOW,
  updated_at: NOW,
};

describe('PostgresTopologyStorage', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let storage: ITopologyStorage;

  beforeEach(() => {
    pool = makeMockPool();
    storage = new PostgresTopologyStorage(pool as any);
  });

  it('findByProvider scopes the SELECT to the provider id and orders by name', async () => {
    pool.query.mockResolvedValueOnce({ rows: [SAMPLE_ROW] });
    const rows = await storage.findByProvider('prov1');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE provider_id = \$1.*ORDER BY name/),
      ['prov1'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      topologyId: 't1',
      providerId: 'prov1',
      name: 'My Bracket',
      description: 'Custom bracket',
      state: { nodes: [], edges: [] },
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('getOne returns null when no row found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const row = await storage.getOne('prov1', 'missing');
    expect(row).toBeNull();
  });

  it('getOne enforces provider scope in the WHERE clause', async () => {
    pool.query.mockResolvedValueOnce({ rows: [SAMPLE_ROW] });
    await storage.getOne('prov1', 't1');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/WHERE provider_id = \$1 AND topology_id = \$2/),
      ['prov1', 't1'],
    );
  });

  it('create stringifies state and returns the inserted row mapped', async () => {
    pool.query.mockResolvedValueOnce({ rows: [SAMPLE_ROW] });
    const row = await storage.create({
      topologyId: 't1',
      providerId: 'prov1',
      name: 'My Bracket',
      description: 'Custom bracket',
      state: { nodes: [], edges: [] },
    });
    const args = pool.query.mock.calls[0][1];
    expect(args[0]).toBe('t1');
    expect(args[1]).toBe('prov1');
    expect(args[4]).toBe('{"nodes":[],"edges":[]}');
    expect(row.topologyId).toBe('t1');
  });

  it('update is a no-op when patch is empty', async () => {
    const result = await storage.update('prov1', 't1', {});
    expect(pool.query).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('update only sets supplied fields and includes provider scope in WHERE', async () => {
    pool.query.mockResolvedValueOnce({});
    await storage.update('prov1', 't1', { name: 'Renamed' });
    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toContain('SET name = $1');
    expect(sql).toContain('updated_at = NOW()');
    expect(sql).toContain('WHERE provider_id = $2 AND topology_id = $3');
    expect(values).toEqual(['Renamed', 'prov1', 't1']);
  });

  it('remove enforces provider scope', async () => {
    pool.query.mockResolvedValueOnce({});
    await storage.remove('prov1', 't1');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM provider_topologies WHERE provider_id = \$1 AND topology_id = \$2/),
      ['prov1', 't1'],
    );
  });
});
