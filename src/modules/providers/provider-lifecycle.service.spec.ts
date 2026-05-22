import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { ProviderLifecycleService } from './provider-lifecycle.service';

describe('ProviderLifecycleService', () => {
  let service: ProviderLifecycleService;
  let mockProviderStorage: any;
  let mockArchiveStorage: any;
  let mockCleanupService: any;
  let mockArchiveService: any;

  const superAdminCtx: any = { isSuperAdmin: true, userId: 'admin-uuid' };
  const nonSuperAdminCtx: any = { isSuperAdmin: false, userId: 'u-1' };
  const providerRow = {
    organisationAbbreviation: 'TESTORG',
    organisationName: 'Test Organisation',
  };

  beforeEach(() => {
    mockProviderStorage = {
      getProvider: jest.fn().mockResolvedValue(providerRow),
    };
    mockArchiveStorage = {
      insert: jest.fn().mockResolvedValue({ archiveId: 'arch-123' }),
    };
    mockCleanupService = {
      getCounts: jest.fn().mockResolvedValue({
        tournaments: 5,
        userAssociations: 2,
        provisionerAssociations: 0,
        tournamentAssignments: 3,
        officialRecords: 0,
        sanctioningRecords: 0,
        tournamentProvisioner: 0,
        pendingSaves: 1,
        calendars: 1,
        topologies: 0,
        catalogItems: 0,
        policies: 0,
        auditLogRows: 42,
      }),
      wipe: jest.fn().mockResolvedValue({
        tournaments: 5,
        userAssociations: 2,
        provisionerAssociations: 0,
        tournamentAssignments: 3,
        officialRecords: 0,
        sanctioningRecords: 0,
        tournamentProvisioner: 0,
        pendingSaves: 1,
        calendars: 1,
        topologies: 0,
        catalogItems: 0,
        policies: 0,
        auditLogRows: 42,
      }),
    };
    mockArchiveService = {
      writeArchive: jest.fn().mockResolvedValue({
        archivePath: '/tmp/archives/TESTORG-2026-05-22T17-00-00-000Z',
        manifestSha256: 'abc123',
        tournamentCount: 5,
        userAssocCount: 2,
        auditLogRows: 42,
      }),
    };

    service = new ProviderLifecycleService(
      mockProviderStorage,
      mockArchiveStorage,
      mockCleanupService,
      mockArchiveService,
    );
  });

  describe('preview', () => {
    it('throws Forbidden for non-super-admin', async () => {
      await expect(service.preview('p-1', nonSuperAdminCtx)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFound when the provider does not exist', async () => {
      mockProviderStorage.getProvider.mockResolvedValue(null);
      await expect(service.preview('p-missing', superAdminCtx)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequest when the provider has no organisationAbbreviation', async () => {
      mockProviderStorage.getProvider.mockResolvedValue({ organisationName: 'No-Abbr' });
      await expect(service.preview('p-1', superAdminCtx)).rejects.toThrow(BadRequestException);
    });

    it('returns counts for a valid provider', async () => {
      const result = await service.preview('p-1', superAdminCtx);
      expect(result.providerAbbr).toBe('TESTORG');
      expect(result.counts.tournaments).toBe(5);
      expect(result.counts.auditLogRows).toBe(42);
    });
  });

  describe('archive', () => {
    it('throws Forbidden for non-super-admin', async () => {
      await expect(service.archive('p-1', 'TESTORG', nonSuperAdminCtx)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequest when confirm does not match abbreviation', async () => {
      await expect(service.archive('p-1', 'WRONG', superAdminCtx)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockArchiveService.writeArchive).not.toHaveBeenCalled();
      expect(mockCleanupService.wipe).not.toHaveBeenCalled();
    });

    it('writes archive, wipes, and records an archive row on the happy path', async () => {
      const result: any = await service.archive('p-1', 'TESTORG', superAdminCtx);

      expect(mockArchiveService.writeArchive).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'p-1', providerAbbr: 'TESTORG' }),
      );
      expect(mockCleanupService.wipe).toHaveBeenCalledWith('p-1', 'TESTORG');
      expect(mockArchiveStorage.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'p-1',
          providerAbbr: 'TESTORG',
          manifestSha256: 'abc123',
          tournamentCount: 5,
          archivedBy: 'admin-uuid',
        }),
      );
      expect(result.success).toBe(true);
      expect(result.archiveId).toBe('arch-123');
    });

    it('writes archive BEFORE wiping (order matters — archive is the durable record)', async () => {
      const callOrder: string[] = [];
      mockArchiveService.writeArchive.mockImplementation(async () => {
        callOrder.push('writeArchive');
        return {
          archivePath: '/tmp/x',
          manifestSha256: 'h',
          tournamentCount: 0,
          userAssocCount: 0,
          auditLogRows: 0,
        };
      });
      mockCleanupService.wipe.mockImplementation(async () => {
        callOrder.push('wipe');
        return {} as any;
      });
      await service.archive('p-1', 'TESTORG', superAdminCtx);
      expect(callOrder).toEqual(['writeArchive', 'wipe']);
    });

    it('does NOT insert provider_archives row when wipe fails (archive dir remains but no DB pointer)', async () => {
      mockCleanupService.wipe.mockRejectedValue(new Error('DB down mid-transaction'));
      await expect(service.archive('p-1', 'TESTORG', superAdminCtx)).rejects.toThrow('DB down');
      expect(mockArchiveService.writeArchive).toHaveBeenCalled();
      expect(mockArchiveStorage.insert).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('throws Forbidden for non-super-admin', async () => {
      await expect(service.delete('p-1', 'TESTORG', true, nonSuperAdminCtx)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequest when confirm does not match abbreviation', async () => {
      await expect(service.delete('p-1', 'WRONG', true, superAdminCtx)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockCleanupService.wipe).not.toHaveBeenCalled();
    });

    it('throws Conflict when acknowledgeDataLoss is false', async () => {
      await expect(service.delete('p-1', 'TESTORG', false, superAdminCtx)).rejects.toThrow(
        ConflictException,
      );
      expect(mockCleanupService.wipe).not.toHaveBeenCalled();
    });

    it('wipes on the happy path, with no archive', async () => {
      const result: any = await service.delete('p-1', 'TESTORG', true, superAdminCtx);

      expect(mockCleanupService.wipe).toHaveBeenCalledWith('p-1', 'TESTORG');
      expect(mockArchiveService.writeArchive).not.toHaveBeenCalled();
      expect(mockArchiveStorage.insert).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.counts.tournaments).toBe(5);
    });
  });
});
