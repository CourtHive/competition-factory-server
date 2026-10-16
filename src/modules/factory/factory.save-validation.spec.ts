import { BadRequestException } from '@nestjs/common';
import type { Mock } from 'vitest';

import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import { MutationServicesService } from '../mutation-services/mutation-services.service';
import { insertPendingSave } from './helpers/pendingSaves';
import { FactoryService } from './factory.service';
import { SUPER_ADMIN } from 'src/common/constants/roles';

vi.mock('./helpers/pendingSaves', () => ({
  insertPendingSave: vi.fn().mockResolvedValue(undefined),
  getPendingSaveStatus: vi.fn(),
  getPendingSaveData: vi.fn(),
  updatePendingSaveStatus: vi.fn(),
}));

const SUPER_ADMIN_USER = { roles: [SUPER_ADMIN], email: 'sa@test.com', userId: 'u-1' };

function makeValidRecord(overrides: any = {}) {
  return {
    tournamentId: 't-1',
    tournamentName: 'Valid',
    startDate: '2026-06-01',
    endDate: '2026-06-07',
    ...overrides,
  };
}

function makeInvalidRecord() {
  return { tournamentId: 't-2', tournamentName: 'Bad', startDate: '06/01/2026', endDate: '06/07/2026' };
}

function makeFactoryService(overrides: { tournamentStorageService?: any; pgPool?: any } = {}) {
  const tournamentStorageService =
    overrides.tournamentStorageService ?? {
      saveTournamentRecords: vi.fn().mockResolvedValue({ success: true }),
    };
  const pgPool = overrides.pgPool ?? {};
  const assignmentsService: any = {
    getAssignedTournamentIds: vi.fn().mockResolvedValue(new Set()),
    getAssignedRoles: vi.fn().mockResolvedValue(new Map()),
  };
  const auditService: any = {};
  const tournamentStorage: any = {};
  const tournamentProvisionerStorage: any = {};
  const providerStorage: any = {};

  // Disabled outbox — enqueueSnapshots short-circuits, so these validation tests
  // exercise the save path without a projection dependency.
  const snapshotProjection: any = new SnapshotProjectionService({ isEnabled: false, enqueue: vi.fn() } as any);

  // Real builder over disabled collaborators — mirrors the production bag shape
  // (A1) rather than a stub that could drift from it.
  const mutationServices: any = new MutationServicesService({ isEnabled: false, enqueue: vi.fn() } as any, {
    record: vi.fn(),
    isEnabled: false,
  } as any);

  const svc = new FactoryService(
    tournamentStorageService,
    snapshotProjection,
    mutationServices,
    assignmentsService,
    auditService,
    tournamentStorage,
    tournamentProvisionerStorage,
    providerStorage,
    pgPool,
  );
  return { svc, tournamentStorageService, pgPool };
}

describe('FactoryService.saveTournamentRecords L2 validation gate', () => {
  beforeEach(() => {
    (insertPendingSave as Mock).mockClear();
    delete process.env.FACTORY_SAVE_VALIDATION_THRESHOLD_BYTES;
  });

  it('persists a small valid record and does not enqueue async validation', async () => {
    const { svc, tournamentStorageService } = makeFactoryService();
    const record = makeValidRecord();

    const result = await svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER);
    expect(result.success).toBe(true);
    expect(tournamentStorageService.saveTournamentRecords).toHaveBeenCalledTimes(1);
    expect(insertPendingSave).not.toHaveBeenCalled();
  });

  it('rejects a malformed record with BadRequestException and does NOT persist it', async () => {
    const { svc, tournamentStorageService } = makeFactoryService();
    const record = makeInvalidRecord();

    await expect(svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tournamentStorageService.saveTournamentRecords).not.toHaveBeenCalled();
    expect(insertPendingSave).not.toHaveBeenCalled();
  });

  it('includes validationErrors and the offending tournamentId in the 400 payload', async () => {
    const { svc } = makeFactoryService();
    const record = makeInvalidRecord();

    try {
      await svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER);
      throw new Error('Expected BadRequestException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(BadRequestException);
      const body = err.getResponse();
      expect(body.tournamentId).toBe('t-2');
      expect(body.validationErrors.length).toBeGreaterThan(0);
      expect(body.validationErrors.some((e: string) => e.includes('startDate'))).toBe(true);
    }
  });

  // Records over a byte threshold used to skip validation, be saved as-is, and be queued for an async pass that never
  // ran (Mentat/planning/CFS_LARGE_SAVES.md). Every record is validated now, whatever its size.
  const OVER_ONE_MIB = 'X'.repeat(1_100_000);

  it('refuses an invalid record of any size, and persists and queues nothing', async () => {
    const { svc, tournamentStorageService } = makeFactoryService();
    const record = { ...makeInvalidRecord(), padding: OVER_ONE_MIB };

    await expect(svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tournamentStorageService.saveTournamentRecords).not.toHaveBeenCalled();
    expect(insertPendingSave).not.toHaveBeenCalled();
  });

  it('persists a valid record over 1 MiB once, and queues nothing for a later pass', async () => {
    const { svc, tournamentStorageService } = makeFactoryService();
    const record = makeValidRecord({ tournamentName: OVER_ONE_MIB });

    const result = await svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER);
    expect(result.success).toBe(true);
    expect(tournamentStorageService.saveTournamentRecords).toHaveBeenCalledTimes(1);
    expect(insertPendingSave).not.toHaveBeenCalled();
  });

  it('ignores the retired threshold variable: a small threshold no longer lets an invalid record through', async () => {
    process.env.FACTORY_SAVE_VALIDATION_THRESHOLD_BYTES = '50';
    const { svc, tournamentStorageService } = makeFactoryService();
    const record = { ...makeInvalidRecord(), padding: 'X'.repeat(500) };

    await expect(svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tournamentStorageService.saveTournamentRecords).not.toHaveBeenCalled();
  });

  it('rejects on the first invalid record in a multi-tournament payload and persists none', async () => {
    const { svc, tournamentStorageService } = makeFactoryService();
    const records = {
      't-1': makeValidRecord(),
      't-2': makeInvalidRecord(),
    };

    await expect(svc.saveTournamentRecords({ tournamentRecords: records }, SUPER_ADMIN_USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tournamentStorageService.saveTournamentRecords).not.toHaveBeenCalled();
  });

  it('still returns the legacy "Invalid user" body-level error for unauthorised callers', async () => {
    const { svc } = makeFactoryService();
    const result = await svc.saveTournamentRecords({ tournamentRecord: makeValidRecord() }, {});
    expect(result.error).toBe('Invalid user');
  });
});
