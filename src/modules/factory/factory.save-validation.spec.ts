import { BadRequestException, Logger } from '@nestjs/common';

import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import { MutationServicesService } from '../mutation-services/mutation-services.service';
import { FactoryService } from './factory.service';
import { SUPER_ADMIN } from 'src/common/constants/roles';
import { mocksEngine } from 'tods-competition-factory';

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

function makeFactoryService(overrides: { tournamentStorageService?: any } = {}) {
  const tournamentStorageService = overrides.tournamentStorageService ?? {
    saveTournamentRecords: vi.fn().mockResolvedValue({ success: true }),
  };
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
  const mutationServices: any = new MutationServicesService(
    { isEnabled: false, enqueue: vi.fn() } as any,
    {
      record: vi.fn(),
      isEnabled: false,
    } as any,
  );

  const svc = new FactoryService(
    tournamentStorageService,
    snapshotProjection,
    mutationServices,
    assignmentsService,
    auditService,
    tournamentStorage,
    tournamentProvisionerStorage,
    providerStorage,
  );
  return { svc, tournamentStorageService };
}

describe('FactoryService.saveTournamentRecords L2 validation gate', () => {
  beforeEach(() => {
    delete process.env.FACTORY_SAVE_VALIDATION_THRESHOLD_BYTES;
  });

  it('persists a small valid record', async () => {
    const { svc, tournamentStorageService } = makeFactoryService();
    const record = makeValidRecord();

    const result = await svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER);
    expect(result.success).toBe(true);
    expect(tournamentStorageService.saveTournamentRecords).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed record with BadRequestException and does NOT persist it', async () => {
    const { svc, tournamentStorageService } = makeFactoryService();
    const record = makeInvalidRecord();

    await expect(svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tournamentStorageService.saveTournamentRecords).not.toHaveBeenCalled();
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

  // Records over a byte threshold used to skip validation and be saved as-is (Mentat/planning/CFS_LARGE_SAVES.md).
  // Every record is validated now, whatever its size.
  const OVER_ONE_MIB = 'X'.repeat(1_100_000);

  it('refuses an invalid record of any size, and persists nothing', async () => {
    const { svc, tournamentStorageService } = makeFactoryService();
    const record = { ...makeInvalidRecord(), padding: OVER_ONE_MIB };

    await expect(svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tournamentStorageService.saveTournamentRecords).not.toHaveBeenCalled();
  });

  it('persists a valid record over 1 MiB once', async () => {
    const { svc, tournamentStorageService } = makeFactoryService();
    const record = makeValidRecord({ tournamentName: OVER_ONE_MIB });

    const result = await svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER);
    expect(result.success).toBe(true);
    expect(tournamentStorageService.saveTournamentRecords).toHaveBeenCalledTimes(1);
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

  // One load-profile line per wholesale save (CFS_LARGE_SAVES §10, P3): the conveyor's real distribution decides how
  // much the deferred snapshot producer matters
  it('writes one load-profile line per wholesale save', async () => {
    const log = vi.spyOn(Logger, 'log').mockImplementation(() => undefined);
    try {
      const { svc } = makeFactoryService();
      await svc.saveTournamentRecords({ tournamentRecord: makeValidRecord() }, SUPER_ADMIN_USER);

      const lines = log.mock.calls.filter(([, context]) => context === 'WholesaleSave');
      expect(lines).toHaveLength(1);
      expect(lines[0][0]).toMatch(
        /tournaments=1 bytes=\d+ validateMs=[\d.]+ integrityMs=[\d.]+ snapshotMs=[\d.]+ deltas=0 mode=inline/,
      );
    } finally {
      log.mockRestore();
    }
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

// DRAW INTEGRITY on the wholesale save (helpers/drawIntegrity.ts). A WINNER/LOSER link without source.roundNumber passes
// validateL2; only the integrity scan sees it. `report` (the default) must still save it, because records already in
// production may carry such findings; `enforce` must refuse it before anything is written.
describe('FactoryService.saveTournamentRecords draw-integrity gate', () => {
  const previousMode = process.env.DRAW_INTEGRITY_MODE;
  let warn: any;

  function corruptedRecord() {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 16, drawType: 'FIRST_MATCH_LOSER_CONSOLATION' }],
      nonRandom: 1,
    });
    const record: any = structuredClone(tournamentRecord);
    const link = record.events[0].drawDefinitions[0].links.find((l: any) => l.linkType === 'LOSER');
    delete link.source.roundNumber;
    return record;
  }

  beforeEach(() => {
    delete process.env.DRAW_INTEGRITY_MODE;
    warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());
  afterAll(() => {
    if (previousMode === undefined) delete process.env.DRAW_INTEGRITY_MODE;
    else process.env.DRAW_INTEGRITY_MODE = previousMode;
  });

  it('report (default): persists the record and logs one structured DrawIntegrity WARN naming it', async () => {
    const { svc, tournamentStorageService } = makeFactoryService();
    const record = corruptedRecord();

    const result = await svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER);
    expect(result.success).toBe(true);
    expect(tournamentStorageService.saveTournamentRecords).toHaveBeenCalledTimes(1);

    const lines = warn.mock.calls.filter(([, context]) => context === 'DrawIntegrity');
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0][0]);
    expect(payload).toMatchObject({ event: 'draw-integrity', mode: 'report', tournamentId: record.tournamentId });
    expect(payload.issueTypes).toContain('LINK_MISSING_SOURCE_ROUND');
  });

  it('enforce: refuses the record with a 400 naming the issue, and persists nothing', async () => {
    process.env.DRAW_INTEGRITY_MODE = 'enforce';
    const { svc, tournamentStorageService } = makeFactoryService();
    const record = corruptedRecord();

    let thrown: any;
    try {
      await svc.saveTournamentRecords({ tournamentRecord: record }, SUPER_ADMIN_USER);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    expect(thrown.getResponse().validationErrors.join(' ')).toContain('LINK_MISSING_SOURCE_ROUND');
    expect(tournamentStorageService.saveTournamentRecords).not.toHaveBeenCalled();
  });

  it('enforce: persists an uncorrupted record with draws', async () => {
    process.env.DRAW_INTEGRITY_MODE = 'enforce';
    const { svc, tournamentStorageService } = makeFactoryService();
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 16, drawType: 'FIRST_MATCH_LOSER_CONSOLATION' }],
      nonRandom: 1,
    });

    const result = await svc.saveTournamentRecords({ tournamentRecord }, SUPER_ADMIN_USER);
    expect(result.success).toBe(true);
    expect(tournamentStorageService.saveTournamentRecords).toHaveBeenCalledTimes(1);
  });
});
