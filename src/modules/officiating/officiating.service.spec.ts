import { OFFICIATING_STORAGE } from 'src/storage/interfaces/officiating-storage.interface';
import { OfficiatingService } from './officiating.service';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';

function createMockStorage() {
  const records: Record<string, any> = {};
  return {
    findOfficialRecord: jest.fn(async ({ officialRecordId }) => {
      const record = records[officialRecordId];
      if (!record) return { error: 'Official record not found' };
      return { officialRecord: record };
    }),
    fetchOfficialRecords: jest.fn(async ({ providerId }) => {
      const all = Object.values(records);
      const filtered = providerId ? all.filter((r: any) => r.providerId === providerId) : all;
      return { success: true, officialRecords: filtered };
    }),
    saveOfficialRecord: jest.fn(async ({ officialRecord }) => {
      records[officialRecord.officialRecordId] = officialRecord;
      return { success: true };
    }),
    removeOfficialRecord: jest.fn(async ({ officialRecordId }) => {
      delete records[officialRecordId];
      return { success: true };
    }),
    listOfficialRecordIds: jest.fn(async () => Object.keys(records)),
    _records: records,
  };
}

describe('OfficiatingService', () => {
  let service: OfficiatingService;
  let mockStorage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    mockStorage = createMockStorage();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfficiatingService,
        { provide: OFFICIATING_STORAGE, useValue: mockStorage },
      ],
    }).compile();

    service = module.get<OfficiatingService>(OfficiatingService);
  });

  describe('createOfficialRecord', () => {
    it('creates a record and saves to storage', async () => {
      let result: any = await service.createOfficialRecord({
        personId: 'person-001',
        providerId: 'provider-1',
      });
      expect(result.officialRecord).toBeDefined();
      expect(result.officialRecord.personId).toBe('person-001');
      expect(mockStorage.saveOfficialRecord).toHaveBeenCalledTimes(1);
    });

    it('returns error for missing personId', async () => {
      let result: any = await service.createOfficialRecord({});
      expect(result.error).toBeDefined();
      expect(mockStorage.saveOfficialRecord).not.toHaveBeenCalled();
    });
  });

  describe('getOfficialRecord', () => {
    it('returns a record by id', async () => {
      let result: any = await service.createOfficialRecord({
        personId: 'person-001',
        providerId: 'provider-1',
      });
      const id = result.officialRecord.officialRecordId;

      result = await service.getOfficialRecord({ officialRecordId: id });
      expect(result.officialRecord).toBeDefined();
      expect(result.officialRecord.personId).toBe('person-001');
    });

    it('returns error for nonexistent id', async () => {
      let result: any = await service.getOfficialRecord({ officialRecordId: 'nonexistent' });
      expect(result.error).toBeDefined();
    });

    it('throws ForbiddenException when user lacks access', async () => {
      let result: any = await service.createOfficialRecord({
        personId: 'person-001',
        providerId: 'provider-1',
      });
      const id = result.officialRecord.officialRecordId;

      const otherUser = { roles: ['client'], providerId: 'provider-2' };
      await expect(service.getOfficialRecord({ officialRecordId: id, user: otherUser })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows SUPER_ADMIN access to any record', async () => {
      let result: any = await service.createOfficialRecord({
        personId: 'person-001',
        providerId: 'provider-1',
      });
      const id = result.officialRecord.officialRecordId;

      const superAdmin = { roles: ['superadmin'], providerId: 'provider-99' };
      result = await service.getOfficialRecord({ officialRecordId: id, user: superAdmin });
      expect(result.officialRecord).toBeDefined();
    });
  });

  describe('listOfficialRecords', () => {
    it('returns all records when no providerId', async () => {
      await service.createOfficialRecord({ personId: 'p1', providerId: 'prov-1' });
      await service.createOfficialRecord({ personId: 'p2', providerId: 'prov-2' });

      let result: any = await service.listOfficialRecords({});
      expect(result.officialRecords.length).toBe(2);
    });

    it('filters by providerId', async () => {
      await service.createOfficialRecord({ personId: 'p1', providerId: 'prov-1' });
      await service.createOfficialRecord({ personId: 'p2', providerId: 'prov-2' });

      let result: any = await service.listOfficialRecords({ providerId: 'prov-1' });
      expect(result.officialRecords.length).toBe(1);
      expect(result.officialRecords[0].personId).toBe('p1');
    });
  });

  describe('executeOfficiatingMethod', () => {
    it('executes a query method on a record', async () => {
      let result: any = await service.createOfficialRecord({
        personId: 'person-001',
        providerId: 'provider-1',
      });
      const id = result.officialRecord.officialRecordId;

      result = await service.executeOfficiatingMethod({
        officialRecordId: id,
        method: 'getOfficialCertifications',
      });
      expect(result.certifications).toBeDefined();
    });

    it('executes a mutation method and saves', async () => {
      let result: any = await service.createOfficialRecord({
        personId: 'person-001',
        providerId: 'provider-1',
      });
      const id = result.officialRecord.officialRecordId;
      const saveCountAfterCreate = mockStorage.saveOfficialRecord.mock.calls.length;

      result = await service.executeOfficiatingMethod({
        officialRecordId: id,
        method: 'addCertification',
        params: {
          organisationId: 'ITF',
          certificationFamily: 'CHAIR_UMPIRE',
          certificationLevel: 'NATIONAL',
        },
      });
      expect(result.success).toBe(true);
      expect(result.certification).toBeDefined();
      // Should have saved again after mutation
      expect(mockStorage.saveOfficialRecord.mock.calls.length).toBeGreaterThan(saveCountAfterCreate);
    });

    it('returns error for unknown method', async () => {
      let result: any = await service.createOfficialRecord({
        personId: 'person-001',
        providerId: 'provider-1',
      });
      const id = result.officialRecord.officialRecordId;

      result = await service.executeOfficiatingMethod({
        officialRecordId: id,
        method: 'nonExistentMethod',
      });
      expect(result.error).toBeDefined();
    });

    it('returns error for nonexistent record', async () => {
      let result: any = await service.executeOfficiatingMethod({
        officialRecordId: 'nonexistent',
        method: 'getOfficialCertifications',
      });
      expect(result.error).toBeDefined();
    });

    it('throws ForbiddenException for unauthorized user', async () => {
      let result: any = await service.createOfficialRecord({
        personId: 'person-001',
        providerId: 'provider-1',
      });
      const id = result.officialRecord.officialRecordId;

      const otherUser = { roles: ['client'], providerId: 'provider-2' };
      await expect(
        service.executeOfficiatingMethod({
          officialRecordId: id,
          method: 'getOfficialCertifications',
          user: otherUser,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('removeOfficialRecord', () => {
    it('removes a record from storage', async () => {
      let result: any = await service.createOfficialRecord({
        personId: 'person-001',
        providerId: 'provider-1',
      });
      const id = result.officialRecord.officialRecordId;

      result = await service.removeOfficialRecord({ officialRecordId: id });
      expect(result.success).toBe(true);
      expect(mockStorage.removeOfficialRecord).toHaveBeenCalledWith({ officialRecordId: id });
    });
  });

  describe('getEvaluationPolicies', () => {
    it('returns policies list', async () => {
      let result: any = await service.getEvaluationPolicies();
      expect(result.success).toBe(true);
      expect(result.policies).toBeDefined();
    });
  });
});
