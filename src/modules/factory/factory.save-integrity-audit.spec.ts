import { factoryConstants, mocksEngine } from 'tods-competition-factory';
import { Logger } from '@nestjs/common';

import { resetDrawIntegrityMemory, snapshotSavedDraws } from './helpers/executionQueueIntegrity';
import { MutationServicesService } from '../mutation-services/mutation-services.service';
import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import { PROVIDER_ADMIN } from 'src/common/constants/roles';
import { FactoryService } from './factory.service';

import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';
import type { DrawIntegrityFindingRow, DrawOpenFindings } from 'src/storage/interfaces';

// A wholesale save (POST /factory/save, the provider-key and provisioner saves) replaces the whole record and raises
// no factory notices, so until 2026-11-17 the executionQueue scan never saw it: a draw it broke reached
// draw_integrity_findings only as a later mutation's `baseline`, and the prod-draw-integrity alert could not fire.
// Nor did it reach audit_log: AuditService.recordSave was defined and never called (0 SAVE rows in 90 days of prod).

const MISSING_TOURNAMENT_RECORD = factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD;
const PROVIDER = 'managed';
const USER_ID = '0b9a4f3e-5a7c-4c1e-9d2b-6f8e1a3c5d7e';

const USER_CONTEXT = {
  userId: USER_ID,
  email: 'director@example.com',
  isSuperAdmin: false,
  globalRoles: ['client'],
  providerRoles: { [PROVIDER]: PROVIDER_ADMIN },
  providerIds: [PROVIDER],
} as UserContext;

const PROVISIONER_CONTEXT = {
  ...USER_CONTEXT,
  userId: 'provisioner:prov-1',
  email: 'provisioner@Prov',
} as UserContext;

/** A record the provider owns, whose only draw carries LINK_MISSING_SOURCE_ROUND (error severity). */
function brokenRecord() {
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    drawProfiles: [{ drawSize: 16, drawType: 'FIRST_MATCH_LOSER_CONSOLATION' }],
    nonRandom: 1,
  });
  const record: any = structuredClone(tournamentRecord);
  record.parentOrganisation = { organisationId: PROVIDER };
  const link = record.events[0].drawDefinitions[0].links.find((l: any) => l.linkType === 'LOSER');
  delete link.source.roundNumber;
  return record;
}

function fakeSink(stored: Record<string, DrawOpenFindings> = {}) {
  const rows: DrawIntegrityFindingRow[] = [];
  return {
    rows,
    record: vi.fn((recorded: DrawIntegrityFindingRow[]) => {
      rows.push(...recorded);
    }),
    loadOpen: vi.fn(async (tournamentId: string, drawId: string) => {
      return stored[`${tournamentId}:${drawId}`] ?? { known: false, open: [] };
    }),
  };
}

/**
 * `exists` makes storage hold the tournament already, so the save is an overwrite rather than a creation.
 * `storedDrawIds` is what `fetchStoredDrawIds` answers (an Error rejects); without it the storage has no such read.
 */
function makeFactoryService({
  exists = false,
  saved = { success: true },
  auditService = { recordSave: vi.fn().mockResolvedValue(undefined) } as any,
  sink = fakeSink(),
  storedDrawIds,
}: {
  exists?: boolean;
  saved?: any;
  auditService?: any;
  sink?: ReturnType<typeof fakeSink>;
  storedDrawIds?: Record<string, string[]> | Error;
} = {}) {
  const tournamentStorageService: any = {
    ...(storedDrawIds && {
      fetchStoredDrawIds: vi.fn(async () => {
        if (storedDrawIds instanceof Error) throw storedDrawIds;
        return storedDrawIds;
      }),
    }),
    saveTournamentRecords: vi.fn().mockResolvedValue(saved),
    fetchTournamentUpdatedAt: vi
      .fn()
      .mockResolvedValue(
        exists
          ? { success: true, providerId: PROVIDER, extensions: [{ name: 'createdByUserId', value: USER_ID }] }
          : { error: MISSING_TOURNAMENT_RECORD },
      ),
  };
  const assignmentsService: any = { getAssignedRoles: vi.fn().mockResolvedValue(new Map()) };
  const snapshotProjection: any = new SnapshotProjectionService({ isEnabled: false, enqueue: vi.fn() } as any);
  // The real bag builder, with the findings sink where MutationServicesModule puts DrawIntegrityFindingsService (A1).
  const mutationServices: any = new MutationServicesService(
    { isEnabled: false, enqueue: vi.fn() } as any,
    { record: vi.fn(), isEnabled: false } as any,
    undefined,
    sink as any,
  );
  const providerStorage: any = { getProvider: vi.fn().mockResolvedValue(undefined) };

  const svc = new FactoryService(
    tournamentStorageService,
    snapshotProjection,
    mutationServices,
    assignmentsService,
    auditService,
    {} as any,
    { create: vi.fn().mockResolvedValue({ success: true }) } as any,
    providerStorage,
  );
  return { svc, sink, auditService, tournamentStorageService };
}

function save(svc: FactoryService, record: any, userContext = USER_CONTEXT) {
  return svc.saveTournamentRecords({ tournamentRecord: record }, { userId: userContext.userId }, userContext);
}

/** The scans run on later turns of the event loop (setImmediate), after the save has answered. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0)).then(() => new Promise(setImmediate));

describe('FactoryService.saveTournamentRecords: draw-integrity findings rows', () => {
  const previousMode = process.env.DRAW_INTEGRITY_MODE;
  let warn: any;

  beforeEach(() => {
    delete process.env.DRAW_INTEGRITY_MODE;
    resetDrawIntegrityMemory();
    warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());
  afterAll(() => {
    if (previousMode === undefined) delete process.env.DRAW_INTEGRITY_MODE;
    else process.env.DRAW_INTEGRITY_MODE = previousMode;
  });

  it('a save that creates a tournament records its broken draw as INTRODUCED by saveTournamentRecords', async () => {
    const { svc, sink } = makeFactoryService();
    const record = brokenRecord();

    const result = await save(svc, record);
    expect(result.success).toBe(true);
    await flush();

    const drawId = record.events[0].drawDefinitions[0].drawId;
    expect(sink.rows.length).toBeGreaterThan(0);
    for (const row of sink.rows) {
      expect(row).toMatchObject({ tournamentId: record.tournamentId, drawId, event: 'introduced' });
      expect(row.methods).toEqual(['saveTournamentRecords']);
    }
    expect(sink.rows.map((row) => row.code)).toContain('LINK_MISSING_SOURCE_ROUND');
    // a created draw had nothing before it: no read-back from the table
    expect(sink.loadOpen).not.toHaveBeenCalled();
  });

  it('keeps the save path to its one DrawIntegrity line per record: the scans write rows, not log lines', async () => {
    const { svc } = makeFactoryService();
    await save(svc, brokenRecord());
    await flush();

    const lines = warn.mock.calls.filter(([, context]: any[]) => context === 'DrawIntegrity');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0][0])).toMatchObject({ event: 'draw-integrity', source: 'factory-save' });
  });

  it('an overwrite diffs each draw against the findings table, and resolves what the save fixed', async () => {
    const record = brokenRecord();
    const drawId = record.events[0].drawDefinitions[0].drawId;
    const known = { fingerprint: 'fp-fixed-by-this-save', code: 'DANGLING_LINK', severity: 'error' };
    const sink = fakeSink({ [`${record.tournamentId}:${drawId}`]: { known: true, open: [known] } });
    const { svc } = makeFactoryService({ exists: true, sink });

    await save(svc, record);
    await flush();

    expect(sink.loadOpen).toHaveBeenCalledWith(record.tournamentId, drawId);
    expect(sink.rows.filter((row) => row.event === 'resolved').map((row) => row.fingerprint)).toEqual([
      'fp-fixed-by-this-save',
    ]);
    expect(sink.rows.filter((row) => row.event === 'introduced').map((row) => row.code)).toContain(
      'LINK_MISSING_SOURCE_ROUND',
    );
  });

  it('records nothing for a save that did not commit', async () => {
    const { svc, sink } = makeFactoryService({ saved: { error: 'Could not persist' } });
    await save(svc, brokenRecord());
    await flush();
    expect(sink.record).not.toHaveBeenCalled();
  });

  it('records nothing with DRAW_INTEGRITY_MODE=off', async () => {
    process.env.DRAW_INTEGRITY_MODE = 'off';
    const { svc, sink } = makeFactoryService();
    await save(svc, brokenRecord());
    await flush();
    expect(sink.record).not.toHaveBeenCalled();
  });
});

// P65: a draw a save ADDS to a tournament that already exists. The table has never recorded it, so unless the save
// knows the draw is new, its findings read as `baseline` and the alert cannot fire on the save that broke it.
describe('FactoryService.saveTournamentRecords: a draw added to an existing tournament', () => {
  const previousMode = process.env.DRAW_INTEGRITY_MODE;
  let warn: any;

  beforeEach(() => {
    delete process.env.DRAW_INTEGRITY_MODE;
    resetDrawIntegrityMemory();
    warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());
  afterAll(() => {
    if (previousMode === undefined) delete process.env.DRAW_INTEGRITY_MODE;
    else process.env.DRAW_INTEGRITY_MODE = previousMode;
  });

  it('is INTRODUCED when the stored record did not hold it', async () => {
    const record = brokenRecord();
    const drawId = record.events[0].drawDefinitions[0].drawId;
    const { svc, sink, tournamentStorageService } = makeFactoryService({
      storedDrawIds: { [record.tournamentId]: ['a-draw-already-stored'] },
      exists: true,
    });

    expect((await save(svc, record)).success).toBe(true);
    await flush();

    expect(tournamentStorageService.fetchStoredDrawIds).toHaveBeenCalledWith({ tournamentIds: [record.tournamentId] });
    // read BEFORE the write: the stored ids are the record as it stood, not as this save left it
    expect(tournamentStorageService.fetchStoredDrawIds.mock.invocationCallOrder[0]).toBeLessThan(
      tournamentStorageService.saveTournamentRecords.mock.invocationCallOrder[0],
    );
    expect(sink.rows.length).toBeGreaterThan(0);
    for (const row of sink.rows) expect(row).toMatchObject({ drawId, event: 'introduced' });
    expect(sink.rows.map((row) => row.code)).toContain('LINK_MISSING_SOURCE_ROUND');
    expect(sink.loadOpen).not.toHaveBeenCalled();
  });

  it('is diffed against the findings table when the stored record held it', async () => {
    const record = brokenRecord();
    const drawId = record.events[0].drawDefinitions[0].drawId;
    const { svc, sink } = makeFactoryService({ exists: true, storedDrawIds: { [record.tournamentId]: [drawId] } });

    await save(svc, record);
    await flush();

    expect(sink.loadOpen).toHaveBeenCalledWith(record.tournamentId, drawId);
    expect(sink.rows.every((row) => row.event === 'baseline')).toBe(true);
  });

  it('a tournament with no stored row has every draw added, even when no gate named it created', () => {
    const record = brokenRecord();
    const batch = snapshotSavedDraws({ tournamentRecords: { [record.tournamentId]: record }, storedDrawIds: {} });
    expect(batch?.draws.map((draw) => draw.added)).toEqual([true]);
  });

  it('falls back to baseline, and still saves, when the stored drawIds cannot be read', async () => {
    const record = brokenRecord();
    const { svc, sink } = makeFactoryService({ exists: true, storedDrawIds: new Error('connection reset') });

    expect((await save(svc, record)).success).toBe(true);
    await flush();

    expect(sink.rows.every((row) => row.event === 'baseline')).toBe(true);
    const failed = warn.mock.calls.map(([line]: any[]) => line).filter((line: any) => /scan-failed/.test(line));
    expect(failed.some((line: string) => line.includes('stored drawIds read failed: connection reset'))).toBe(true);
  });

  it('reads no stored drawIds with DRAW_INTEGRITY_MODE=off', async () => {
    process.env.DRAW_INTEGRITY_MODE = 'off';
    const { svc, tournamentStorageService } = makeFactoryService({ exists: true, storedDrawIds: {} });
    await save(svc, brokenRecord());
    await flush();
    expect(tournamentStorageService.fetchStoredDrawIds).not.toHaveBeenCalled();
  });

  it('reads nothing for a tournament the save creates', async () => {
    const { svc, tournamentStorageService } = makeFactoryService({ storedDrawIds: {} });
    await save(svc, brokenRecord());
    await flush();
    expect(tournamentStorageService.fetchStoredDrawIds).not.toHaveBeenCalled();
  });
});

describe('FactoryService.saveTournamentRecords: audit_log SAVE rows', () => {
  beforeEach(() => resetDrawIntegrityMemory());

  it('records one SAVE per saved tournament, naming the user', async () => {
    const { svc, auditService } = makeFactoryService();
    const record = brokenRecord();
    await save(svc, record);
    await flush();

    expect(auditService.recordSave).toHaveBeenCalledTimes(1);
    expect(auditService.recordSave).toHaveBeenCalledWith({
      tournamentId: record.tournamentId,
      userId: USER_ID,
      userEmail: 'director@example.com',
      source: 'tmx',
    });
  });

  it('labels a provisioner save as such', async () => {
    const { svc, auditService } = makeFactoryService();
    await save(svc, brokenRecord(), PROVISIONER_CONTEXT);
    await flush();
    expect(auditService.recordSave).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'provisioner:prov-1', source: 'provisioner' }),
    );
  });

  it('records nothing for a save that did not commit', async () => {
    const { svc, auditService } = makeFactoryService({ saved: { error: 'Could not persist' } });
    await save(svc, brokenRecord());
    await flush();
    expect(auditService.recordSave).not.toHaveBeenCalled();
  });

  it('an audit failure, even a synchronous throw, never fails the save', async () => {
    const error = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
    const auditService = {
      recordSave: vi.fn(() => {
        throw new Error('audit storage down');
      }),
    };
    const { svc } = makeFactoryService({ auditService });

    const result = await save(svc, brokenRecord());
    await flush();

    expect(result.success).toBe(true);
    expect(error).toHaveBeenCalledWith('Audit hook failed: audit storage down', 'saveTournamentRecords');
    error.mockRestore();
  });
});
