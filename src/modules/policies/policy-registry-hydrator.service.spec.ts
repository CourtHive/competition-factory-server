import { PolicyRegistryHydrator } from './policy-registry-hydrator.service';
import { IPolicyStorage, PolicyRecord } from 'src/storage/interfaces/policy-storage.interface';
import { policyRegistry } from './factory-bridge';

function makeMockStorage(policies: PolicyRecord[]): jest.Mocked<IPolicyStorage> {
  return {
    savePolicy: jest.fn(),
    getPolicy: jest.fn(),
    findById: jest.fn(),
    listPolicies: jest.fn().mockResolvedValue({ policies }),
    deletePolicy: jest.fn(),
  };
}

function makeRecord(overrides: Partial<PolicyRecord> = {}): PolicyRecord {
  return {
    policyId: 'p-1',
    providerId: null,
    policyType: 'rankingPoints',
    name: 'BASIC',
    version: '1.0.0',
    visibility: 'TEMPLATE_REF',
    definition: { awardProfiles: [{ profileName: 'main' }] },
    publishedAt: new Date(),
    ...overrides,
  };
}

describe('PolicyRegistryHydrator', () => {
  beforeEach(() => policyRegistry.clear());
  afterEach(() => policyRegistry.clear());

  it('registers every policy returned by storage', async () => {
    const records = [
      makeRecord(),
      makeRecord({ policyId: 'p-2', name: 'LTA', providerId: 'prov-lta', visibility: 'PROVIDER_PRIVATE' }),
    ];
    const hydrator = new PolicyRegistryHydrator(makeMockStorage(records));

    await hydrator.onApplicationBootstrap();

    expect(policyRegistry.lookup({ policyType: 'rankingPoints', name: 'BASIC' })).toEqual(records[0].definition);
    expect(policyRegistry.lookup({ policyType: 'rankingPoints', name: 'LTA' })).toEqual(records[1].definition);
  });

  it('preserves version when registering multi-version sets', async () => {
    const v1 = makeRecord({ policyId: 'p-1', version: '1.0.0', definition: { awardProfiles: [{ v: 1 }] } });
    const v2 = makeRecord({ policyId: 'p-2', version: '2.0.0', definition: { awardProfiles: [{ v: 2 }] } });
    const hydrator = new PolicyRegistryHydrator(makeMockStorage([v1, v2]));

    await hydrator.onApplicationBootstrap();

    expect(policyRegistry.lookup({ policyType: 'rankingPoints', name: 'BASIC', version: '1.0.0' })).toEqual(v1.definition);
    expect(policyRegistry.lookup({ policyType: 'rankingPoints', name: 'BASIC', version: '2.0.0' })).toEqual(v2.definition);
  });

  it('runs cleanly when storage is empty', async () => {
    const hydrator = new PolicyRegistryHydrator(makeMockStorage([]));
    await expect(hydrator.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(policyRegistry.list()).toHaveLength(0);
  });
});
