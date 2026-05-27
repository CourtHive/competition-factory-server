import { BadRequestException } from '@nestjs/common';

import { insertPendingSave } from './helpers/pendingSaves';
import { FactoryService } from './factory.service';
import { SUPER_ADMIN } from 'src/common/constants/roles';

jest.mock('./helpers/pendingSaves', () => ({
  insertPendingSave: jest.fn().mockResolvedValue(undefined),
  getPendingSaveStatus: jest.fn(),
  getPendingSaveData: jest.fn(),
  updatePendingSaveStatus: jest.fn(),
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
      saveTournamentRecords: jest.fn().mockResolvedValue({ success: true }),
    };
  const pgPool = overrides.pgPool ?? {};
  const assignmentsService: any = { getAssignedTournamentIds: jest.fn().mockResolvedValue([]) };
  const auditService: any = {};
  const tournamentStorage: any = {};
  const tournamentProvisionerStorage: any = {};
  const providerStorage: any = {};

  const svc = new FactoryService(
    tournamentStorageService,
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
    (insertPendingSave as jest.Mock).mockClear();
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

  it('over-threshold records skip sync L2 and are queued for async validation', async () => {
    process.env.FACTORY_SAVE_VALIDATION_THRESHOLD_BYTES = '100';
    const { svc, tournamentStorageService } = makeFactoryService();
    const record = makeValidRecord({
      tournamentName: 'X'.repeat(500), // pushes JSON well over the 100-byte threshold
    });

    const result = await svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER);
    expect(result.success).toBe(true);
    expect(tournamentStorageService.saveTournamentRecords).toHaveBeenCalledTimes(1);
    expect(insertPendingSave).toHaveBeenCalledTimes(1);
    const call = (insertPendingSave as jest.Mock).mock.calls[0][1];
    expect(call.tournamentId).toBe('t-1');
    expect(call.validationLevel).toBe('L2');
  });

  it('over-threshold records bypass even structural L2 errors (size escape hatch)', async () => {
    process.env.FACTORY_SAVE_VALIDATION_THRESHOLD_BYTES = '50';
    const { svc, tournamentStorageService } = makeFactoryService();
    // Malformed record padded to exceed threshold — sync L2 would reject it,
    // but the size gate routes it to the async queue instead.
    const record = { ...makeInvalidRecord(), padding: 'X'.repeat(500) };

    const result = await svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER);
    expect(result.success).toBe(true);
    expect(tournamentStorageService.saveTournamentRecords).toHaveBeenCalledTimes(1);
    expect(insertPendingSave).toHaveBeenCalledTimes(1);
  });

  it('falls back to the 1 MB default when the env var is unset', async () => {
    delete process.env.FACTORY_SAVE_VALIDATION_THRESHOLD_BYTES;
    const { svc, tournamentStorageService } = makeFactoryService();
    const record = makeValidRecord(); // tiny, well under 1 MB

    await svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER);
    expect(tournamentStorageService.saveTournamentRecords).toHaveBeenCalledTimes(1);
    expect(insertPendingSave).not.toHaveBeenCalled();
  });

  it('ignores a non-numeric env var and uses the default threshold', async () => {
    process.env.FACTORY_SAVE_VALIDATION_THRESHOLD_BYTES = 'not-a-number';
    const { svc } = makeFactoryService();
    const record = makeValidRecord();

    const result = await svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER);
    expect(result.success).toBe(true);
    expect(insertPendingSave).not.toHaveBeenCalled();
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
