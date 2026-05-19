import { PostgresPolicyStorage } from './postgres-policy.storage';
import { IPolicyStorage } from '../interfaces/policy-storage.interface';

function makeMockPool() {
  return { query: jest.fn() };
}

function row(overrides: any = {}) {
  return {
    policy_id: 'p1',
    provider_id: 'prov-1',
    policy_type: 'rankingPoints',
    name: 'USTA_JUNIOR_2026',
    version: '1.0.0',
    visibility: 'PROVIDER_PRIVATE',
    definition: { awardProfiles: [] },
    metadata: null,
    published_at: new Date('2026-05-19T00:00:00Z'),
    published_by: 'system',
    ...overrides,
  };
}

describe('PostgresPolicyStorage', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let storage: IPolicyStorage;

  beforeEach(() => {
    pool = makeMockPool();
    storage = new PostgresPolicyStorage(pool as any);
  });

  describe('savePolicy', () => {
    it('inserts with JSON-stringified definition and metadata', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      let result: any = await storage.savePolicy({
        policyId: 'p1',
        providerId: 'prov-1',
        policyType: 'rankingPoints',
        name: 'USTA_JUNIOR_2026',
        version: '1.0.0',
        visibility: 'PROVIDER_PRIVATE',
        definition: { awardProfiles: [{ profileName: 'main' }] },
        metadata: { source: 'seed' },
        publishedBy: 'user-42',
      });

      expect(result.success).toBe(true);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO policies');
      expect(params).toEqual([
        'p1',
        'prov-1',
        'rankingPoints',
        'USTA_JUNIOR_2026',
        '1.0.0',
        'PROVIDER_PRIVATE',
        JSON.stringify({ awardProfiles: [{ profileName: 'main' }] }),
        JSON.stringify({ source: 'seed' }),
        'user-42',
      ]);
    });

    it('serializes a null providerId, missing metadata, and missing publishedBy', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      let result: any = await storage.savePolicy({
        policyId: 'p2',
        providerId: null,
        policyType: 'rankingPoints',
        name: 'BASIC',
        version: '1.0.0',
        visibility: 'TEMPLATE_REF',
        definition: { awardProfiles: [] },
      });

      expect(result.success).toBe(true);
      const params = pool.query.mock.calls[0][1];
      expect(params[1]).toBeNull();
      expect(params[7]).toBeNull();
      expect(params[8]).toBeNull();
    });
  });

  describe('getPolicy', () => {
    it('returns mapped record when found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [row()] });

      let result: any = await storage.getPolicy({
        policyType: 'rankingPoints',
        name: 'USTA_JUNIOR_2026',
      });

      expect(result.policy).toBeDefined();
      expect(result.policy.policyId).toBe('p1');
      expect(result.policy.providerId).toBe('prov-1');
      expect(result.policy.visibility).toBe('PROVIDER_PRIVATE');
    });

    it('returns empty object when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.getPolicy({ policyType: 'rankingPoints', name: 'MISSING' });
      expect(result.policy).toBeUndefined();
    });

    it('filters by version when provided', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await storage.getPolicy({
        policyType: 'rankingPoints',
        name: 'USTA_JUNIOR_2026',
        version: '2.0.0',
      });
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('version = $');
      expect(params).toContain('2.0.0');
    });

    it('filters by null providerId when explicitly passed null', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await storage.getPolicy({ policyType: 'rankingPoints', name: 'BASIC', providerId: null });
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('provider_id IS NULL');
    });

    it('filters by providerId when string passed', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await storage.getPolicy({
        policyType: 'rankingPoints',
        name: 'USTA_JUNIOR_2026',
        providerId: 'prov-7',
      });
      const params = pool.query.mock.calls[0][1];
      expect(params).toContain('prov-7');
    });
  });

  describe('findById', () => {
    it('returns mapped record when present and not deleted', async () => {
      pool.query.mockResolvedValueOnce({ rows: [row()] });
      let result: any = await storage.findById('p1');
      expect(result.policy.policyId).toBe('p1');
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('policy_id = $1');
      expect(sql).toContain('deleted_at IS NULL');
    });

    it('returns empty when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.findById('missing');
      expect(result.policy).toBeUndefined();
    });
  });

  describe('listPolicies', () => {
    it('returns mapped rows', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [row(), row({ policy_id: 'p2', name: 'LTA', version: '2.0.0' })],
      });
      let result: any = await storage.listPolicies({ providerId: 'prov-1' });
      expect(result.policies).toHaveLength(2);
      expect(result.policies[1].name).toBe('LTA');
    });

    it('includes global rows when includeGlobal is set', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await storage.listPolicies({ providerId: 'prov-1', includeGlobal: true });
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('provider_id IS NULL');
      expect(sql).toContain('OR');
    });

    it('filters by visibility list', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await storage.listPolicies({ visibilities: ['SHARED_DEMO', 'TEMPLATE_REF'] });
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('visibility IN');
      expect(params).toEqual(expect.arrayContaining(['SHARED_DEMO', 'TEMPLATE_REF']));
    });

    it('filters by policyType', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await storage.listPolicies({ policyType: 'rankingPoints' });
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('policy_type = $');
      expect(params).toContain('rankingPoints');
    });

    it('excludes deleted rows in WHERE clause', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await storage.listPolicies({});
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('deleted_at IS NULL');
    });
  });

  describe('deletePolicy', () => {
    it('soft-deletes by setting deleted_at', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      let result: any = await storage.deletePolicy({ policyId: 'p1' });
      expect(result.success).toBe(true);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('UPDATE policies SET deleted_at = now()');
      expect(params).toEqual(['p1']);
    });
  });
});
