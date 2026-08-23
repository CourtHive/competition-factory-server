import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import { MutationServicesService } from '../mutation-services/mutation-services.service';
import { withTournamentLock } from 'src/services/tournamentMutex';
import { FactoryService } from './factory.service';
import { SUPER_ADMIN } from 'src/common/constants/roles';

jest.mock('./helpers/pendingSaves', () => ({
  insertPendingSave: jest.fn().mockResolvedValue(undefined),
  getPendingSaveStatus: jest.fn(),
  getPendingSaveData: jest.fn(),
  updatePendingSaveStatus: jest.fn(),
}));

const USER = { roles: [SUPER_ADMIN], email: 'sa@test.com', userId: 'u-1' };

const record = (tournamentId = 't-1') => ({
  tournamentId,
  tournamentName: 'Orange Bowl',
  startDate: '2026-12-05',
  endDate: '2026-12-12',
});

function makeService({ onSave }: { onSave?: () => Promise<void> } = {}) {
  const saveOrder: string[] = [];
  const tournamentStorageService: any = {
    saveTournamentRecords: jest.fn(async () => {
      saveOrder.push('save:start');
      if (onSave) await onSave();
      saveOrder.push('save:end');
      return { success: true };
    }),
  };

  const outbox: any = { isEnabled: true, enqueue: jest.fn().mockResolvedValue(undefined) };
  const snapshotProjection = new SnapshotProjectionService(outbox);
  const enqueueSnapshots = jest
    .spyOn(snapshotProjection, 'enqueueSnapshots')
    .mockImplementation(async () => {
      saveOrder.push('project');
      return 1;
    });

  const svc = new FactoryService(
    tournamentStorageService,
    snapshotProjection as any,
    new MutationServicesService(outbox, { record: jest.fn(), isEnabled: false } as any) as any,
    {
      getAssignedTournamentIds: jest.fn().mockResolvedValue(new Set()),
      getAssignedRoles: jest.fn().mockResolvedValue(new Map()),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  return { svc, tournamentStorageService, enqueueSnapshots, saveOrder };
}

describe('FactoryService.saveTournamentRecords — per-tournament lock', () => {
  it('serialises a wholesale save against a concurrent holder of the same lock', async () => {
    const events: string[] = [];
    let releaseMutation!: () => void;
    const mutationHolding = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });

    // Stand in for an in-flight executionQueue mutation on t-1: it holds the
    // per-tournament lock across an await, exactly as the real mutation path
    // does around fetch → mutate → save.
    const mutation = withTournamentLock(['t-1'], async () => {
      events.push('mutation:enter');
      await mutationHolding;
      events.push('mutation:exit');
    });

    const { svc, tournamentStorageService } = makeService();
    const save = svc
      .saveTournamentRecords({ tournamentRecord: record() }, USER)
      .then(() => events.push('save:done'));

    // Give the save every chance to run ahead if it were unlocked.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // THE REGRESSION THIS GUARDS: before the fix the wholesale save took no
    // lock, so it wrote the whole record straight over an in-flight mutation.
    expect(tournamentStorageService.saveTournamentRecords).not.toHaveBeenCalled();

    releaseMutation();
    await mutation;
    await save;

    expect(events).toEqual(['mutation:enter', 'mutation:exit', 'save:done']);
  });

  it('does not serialise saves for unrelated tournaments', async () => {
    let release!: () => void;
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    const other = withTournamentLock(['t-OTHER'], async () => holding);

    const { svc, tournamentStorageService } = makeService();
    await svc.saveTournamentRecords({ tournamentRecord: record('t-1') }, USER);

    // A lock on a different tournament must not block this one — the mutex is
    // per tournament, not global.
    expect(tournamentStorageService.saveTournamentRecords).toHaveBeenCalledTimes(1);

    release();
    await other;
  });

  it('projects a snapshot after the record commits, never before', async () => {
    const { svc, saveOrder } = makeService();

    await svc.saveTournamentRecords({ tournamentRecord: record() }, USER);

    // Post-commit ordering keeps the read model from ever getting ahead of the
    // record — the same seam executionQueue uses for its delta flush.
    expect(saveOrder).toEqual(['save:start', 'save:end', 'project']);
  });

  it('does not project when the save fails', async () => {
    const { svc, tournamentStorageService, enqueueSnapshots } = makeService();
    tournamentStorageService.saveTournamentRecords.mockResolvedValueOnce({ error: 'nope' });

    await svc.saveTournamentRecords({ tournamentRecord: record() }, USER);

    expect(enqueueSnapshots).not.toHaveBeenCalled();
  });

  it('releases the lock when the save throws, so the tournament is not wedged', async () => {
    const { svc, tournamentStorageService } = makeService();
    tournamentStorageService.saveTournamentRecords.mockRejectedValueOnce(new Error('storage down'));

    await expect(svc.saveTournamentRecords({ tournamentRecord: record() }, USER)).rejects.toThrow('storage down');

    // A lock leaked on the error path would make every later mutation on this
    // tournament hang until the 30s timeout.
    let acquired = false;
    await withTournamentLock(['t-1'], async () => {
      acquired = true;
    });
    expect(acquired).toBe(true);
  });
});
