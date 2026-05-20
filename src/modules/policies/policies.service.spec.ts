import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { PoliciesService } from './policies.service';
import { IPolicyStorage, PolicyRecord } from 'src/storage/interfaces/policy-storage.interface';
import { UserContext } from '../auth/decorators/user-context.decorator';
import { PROVIDER_ADMIN } from 'src/common/constants/roles';
import { policyRegistry } from './factory-bridge';

function makeMockStorage(): jest.Mocked<IPolicyStorage> {
  return {
    savePolicy: jest.fn(),
    getPolicy: jest.fn(),
    findById: jest.fn(),
    listPolicies: jest.fn(),
    deletePolicy: jest.fn(),
  };
}

function makeRecord(overrides: Partial<PolicyRecord> = {}): PolicyRecord {
  return {
    policyId: 'p-1',
    providerId: 'prov-a',
    policyType: 'rankingPoints',
    name: 'USTA_JUNIOR_2026',
    version: '1.0.0',
    visibility: 'PROVIDER_PRIVATE',
    definition: { awardProfiles: [{ profileName: 'main' }] },
    metadata: null,
    publishedAt: new Date('2026-05-19T00:00:00Z'),
    publishedBy: 'user-1',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: 'user-1',
    email: 'admin@prov-a.test',
    isSuperAdmin: false,
    globalRoles: ['client'],
    providerRoles: { 'prov-a': PROVIDER_ADMIN },
    providerIds: ['prov-a'],
    ...overrides,
  };
}

describe('PoliciesService', () => {
  let storage: jest.Mocked<IPolicyStorage>;
  let service: PoliciesService;

  beforeEach(() => {
    storage = makeMockStorage();
    service = new PoliciesService(storage);
    policyRegistry.clear();
  });

  afterEach(() => policyRegistry.clear());

  describe('listPublicCatalog', () => {
    it('asks storage for global PUBLIC visibilities only', async () => {
      storage.listPolicies.mockResolvedValueOnce({ policies: [makeRecord({ visibility: 'SHARED_DEMO' })] });
      const result = await service.listPublicCatalog({});
      expect(storage.listPolicies).toHaveBeenCalledWith({
        providerId: null,
        visibilities: ['SHARED_DEMO', 'TEMPLATE_REF'],
        policyType: undefined,
      });
      expect(result.policies).toHaveLength(1);
    });
  });

  describe('listForUser', () => {
    it('merges per-provider rows with global SHARED_DEMO/TEMPLATE_REF, dedup by policyId', async () => {
      storage.listPolicies
        .mockResolvedValueOnce({ policies: [makeRecord({ policyId: 'p-private' })] })
        .mockResolvedValueOnce({
          policies: [
            makeRecord({ policyId: 'p-demo', providerId: null, visibility: 'SHARED_DEMO' }),
            makeRecord({ policyId: 'p-private' }),
          ],
        });

      const result = await service.listForUser(makeCtx(), {});
      const ids = result.policies.map((p) => p.policyId).sort();
      expect(ids).toEqual(['p-demo', 'p-private']);
    });
  });

  describe('getOne', () => {
    it('returns a global SHARED_DEMO without needing context', async () => {
      storage.getPolicy.mockResolvedValueOnce({ policy: makeRecord({ providerId: null, visibility: 'SHARED_DEMO' }) });
      const result = await service.getOne({ policyType: 'rankingPoints', name: 'X' });
      expect(result.visibility).toBe('SHARED_DEMO');
    });

    it('falls through to provider-scoped record', async () => {
      storage.getPolicy
        .mockResolvedValueOnce({}) // global miss
        .mockResolvedValueOnce({ policy: makeRecord() });
      const result = await service.getOne({ policyType: 'rankingPoints', name: 'X' }, makeCtx());
      expect(result.providerId).toBe('prov-a');
    });

    it('throws NotFoundException when nothing matches', async () => {
      storage.getPolicy.mockResolvedValueOnce({}).mockResolvedValueOnce({});
      await expect(service.getOne({ policyType: 'rankingPoints', name: 'NONE' }, makeCtx())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not return a global PROVIDER_PRIVATE without context', async () => {
      storage.getPolicy.mockResolvedValueOnce({
        policy: makeRecord({ providerId: null, visibility: 'PROVIDER_PRIVATE' }),
      });
      await expect(service.getOne({ policyType: 'rankingPoints', name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('save', () => {
    const baseInput = {
      providerId: 'prov-a',
      policyType: 'rankingPoints',
      name: 'USTA_JUNIOR_2026',
      version: '1.0.0',
      visibility: 'PROVIDER_PRIVATE' as const,
      definition: { awardProfiles: [{ profileName: 'main' }] },
    };

    it('lets a PROVIDER_ADMIN publish to their own provider', async () => {
      storage.savePolicy.mockResolvedValueOnce({ success: true });
      storage.findById.mockResolvedValueOnce({ policy: makeRecord() });
      const result = await service.save(baseInput, makeCtx());
      expect(result.policy.providerId).toBe('prov-a');
      expect(storage.savePolicy).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'prov-a', publishedBy: 'user-1' }),
      );
    });

    it('registers the saved policy in the embedded factory engine registry', async () => {
      storage.savePolicy.mockResolvedValueOnce({ success: true });
      const record = makeRecord();
      storage.findById.mockResolvedValueOnce({ policy: record });

      await service.save(baseInput, makeCtx());

      expect(policyRegistry.lookup({ policyType: 'rankingPoints', name: 'USTA_JUNIOR_2026' })).toEqual(record.definition);
    });

    it('rejects a PROVIDER_ADMIN trying to publish to a different provider', async () => {
      await expect(service.save({ ...baseInput, providerId: 'prov-b' }, makeCtx())).rejects.toThrow(ForbiddenException);
      expect(storage.savePolicy).not.toHaveBeenCalled();
    });

    it('rejects a PROVIDER_ADMIN publishing a global SHARED_DEMO', async () => {
      await expect(
        service.save({ ...baseInput, providerId: null, visibility: 'SHARED_DEMO' }, makeCtx()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a SUPER_ADMIN to publish a global TEMPLATE_REF', async () => {
      storage.savePolicy.mockResolvedValueOnce({ success: true });
      storage.findById.mockResolvedValueOnce({
        policy: makeRecord({ providerId: null, visibility: 'TEMPLATE_REF' }),
      });
      const result = await service.save(
        { ...baseInput, providerId: null, visibility: 'TEMPLATE_REF' },
        makeCtx({ isSuperAdmin: true, providerIds: [], providerRoles: {} }),
      );
      expect(result.policy.visibility).toBe('TEMPLATE_REF');
    });

    it('rejects a malformed definition', async () => {
      await expect(
        service.save({ ...baseInput, definition: { awardProfiles: [] } }, makeCtx()),
      ).rejects.toThrow(ForbiddenException);
      expect(storage.savePolicy).not.toHaveBeenCalled();
    });
  });

  describe('deleteByPolicyId', () => {
    it('lets a PROVIDER_ADMIN soft-delete their own provider record', async () => {
      storage.findById.mockResolvedValueOnce({ policy: makeRecord() });
      storage.deletePolicy.mockResolvedValueOnce({ success: true });
      await service.deleteByPolicyId('p-1', makeCtx());
      expect(storage.deletePolicy).toHaveBeenCalledWith({ policyId: 'p-1' });
    });

    it('throws NotFound when policy does not exist', async () => {
      storage.findById.mockResolvedValueOnce({});
      await expect(service.deleteByPolicyId('missing', makeCtx())).rejects.toThrow(NotFoundException);
    });

    it("rejects a PROVIDER_ADMIN trying to delete another provider's record", async () => {
      storage.findById.mockResolvedValueOnce({ policy: makeRecord({ providerId: 'prov-other' }) });
      await expect(service.deleteByPolicyId('p-1', makeCtx())).rejects.toThrow(ForbiddenException);
      expect(storage.deletePolicy).not.toHaveBeenCalled();
    });

    it('lets SUPER_ADMIN delete a global TEMPLATE_REF', async () => {
      storage.findById.mockResolvedValueOnce({
        policy: makeRecord({ providerId: null, visibility: 'TEMPLATE_REF' }),
      });
      storage.deletePolicy.mockResolvedValueOnce({ success: true });
      await service.deleteByPolicyId('p-1', makeCtx({ isSuperAdmin: true, providerIds: [], providerRoles: {} }));
      expect(storage.deletePolicy).toHaveBeenCalled();
    });
  });
});
