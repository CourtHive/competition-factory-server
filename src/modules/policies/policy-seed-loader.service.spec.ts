import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { PolicySeedLoader } from './policy-seed-loader.service';
import { IPolicyStorage } from 'src/storage/interfaces/policy-storage.interface';

function makeMockStorage(): jest.Mocked<IPolicyStorage> {
  return {
    savePolicy: jest.fn(),
    getPolicy: jest.fn(),
    findById: jest.fn(),
    listPolicies: jest.fn(),
    deletePolicy: jest.fn(),
  };
}

async function withTempCwd(setup: (dir: string) => Promise<void>, run: () => Promise<void>) {
  const tmp = await mkdtemp(join(tmpdir(), 'policy-seed-test-'));
  const seedsRoot = join(tmp, 'seeds', 'policies');
  await mkdir(seedsRoot, { recursive: true });
  await setup(seedsRoot);

  const originalCwd = process.cwd();
  process.chdir(tmp);
  try {
    await run();
  } finally {
    process.chdir(originalCwd);
    await rm(tmp, { recursive: true, force: true });
  }
}

const validSeed = {
  providerId: null,
  policyType: 'rankingPoints',
  name: 'BASIC',
  version: '1.0.0',
  visibility: 'TEMPLATE_REF' as const,
  definition: { awardProfiles: [{ profileName: 'main' }] },
};

describe('PolicySeedLoader', () => {
  let storage: jest.Mocked<IPolicyStorage>;
  let loader: PolicySeedLoader;

  beforeEach(() => {
    storage = makeMockStorage();
    loader = new PolicySeedLoader(storage);
  });

  it('skips silently when seeds/policies directory does not exist', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'policy-seed-test-'));
    const originalCwd = process.cwd();
    process.chdir(tmp);
    try {
      await loader.onModuleInit();
      expect(storage.getPolicy).not.toHaveBeenCalled();
      expect(storage.savePolicy).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('inserts a new seed via savePolicy when not already present', async () => {
    storage.getPolicy.mockResolvedValue({});
    storage.savePolicy.mockResolvedValue({ success: true });

    await withTempCwd(
      async (seedsRoot) => {
        await writeFile(join(seedsRoot, 'basic-1.0.0.json'), JSON.stringify(validSeed));
      },
      async () => {
        await loader.onModuleInit();
      },
    );

    expect(storage.savePolicy).toHaveBeenCalledTimes(1);
    expect(storage.savePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: null,
        policyType: 'rankingPoints',
        name: 'BASIC',
        version: '1.0.0',
        visibility: 'TEMPLATE_REF',
        publishedBy: 'seed-loader',
      }),
    );
  });

  it('skips already-present seeds (idempotent boot)', async () => {
    storage.getPolicy.mockResolvedValue({
      policy: {
        policyId: 'existing',
        providerId: null,
        policyType: 'rankingPoints',
        name: 'BASIC',
        version: '1.0.0',
        visibility: 'TEMPLATE_REF',
        definition: validSeed.definition,
        publishedAt: new Date(),
      },
    });

    await withTempCwd(
      async (seedsRoot) => {
        await writeFile(join(seedsRoot, 'basic-1.0.0.json'), JSON.stringify(validSeed));
      },
      async () => {
        await loader.onModuleInit();
      },
    );

    expect(storage.savePolicy).not.toHaveBeenCalled();
  });

  it('rejects a malformed seed without aborting the rest', async () => {
    storage.getPolicy.mockResolvedValue({});
    storage.savePolicy.mockResolvedValue({ success: true });

    await withTempCwd(
      async (seedsRoot) => {
        await writeFile(join(seedsRoot, 'malformed.json'), JSON.stringify({ broken: true }));
        await writeFile(join(seedsRoot, 'basic-1.0.0.json'), JSON.stringify(validSeed));
      },
      async () => {
        await loader.onModuleInit();
      },
    );

    expect(storage.savePolicy).toHaveBeenCalledTimes(1);
  });

  it('skips PROVIDER_PRIVATE seed when the providers row is missing (FK violation)', async () => {
    storage.getPolicy.mockResolvedValue({});
    storage.savePolicy.mockRejectedValue(new Error('insert violates foreign key constraint "policies_provider_id_fkey"'));

    const privateSeed = {
      ...validSeed,
      providerId: 'unknown-provider',
      visibility: 'PROVIDER_PRIVATE' as const,
      name: 'USTA_JUNIOR_2026',
    };

    await withTempCwd(
      async (seedsRoot) => {
        const nested = join(seedsRoot, 'usta');
        await mkdir(nested, { recursive: true });
        await writeFile(join(nested, 'usta-junior-2026-1.0.0.json'), JSON.stringify(privateSeed));
      },
      async () => {
        await loader.onModuleInit();
      },
    );

    expect(storage.savePolicy).toHaveBeenCalledTimes(1);
  });

  it('walks nested directories', async () => {
    storage.getPolicy.mockResolvedValue({});
    storage.savePolicy.mockResolvedValue({ success: true });

    await withTempCwd(
      async (seedsRoot) => {
        const nested = join(seedsRoot, 'group-a', 'sub');
        await mkdir(nested, { recursive: true });
        await writeFile(join(nested, 'deep-1.0.0.json'), JSON.stringify({ ...validSeed, name: 'DEEP' }));
      },
      async () => {
        await loader.onModuleInit();
      },
    );

    expect(storage.savePolicy).toHaveBeenCalledWith(expect.objectContaining({ name: 'DEEP' }));
  });
});
