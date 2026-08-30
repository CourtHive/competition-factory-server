import { PostgresTournamentStorage } from './postgres-tournament.storage';
import { FENCED_BY_NEWER_OWNER } from 'src/common/constants/app';

function makeMockPool() {
  return { query: vi.fn() };
}

function record(overrides: any = {}) {
  return {
    tournamentId: 't-1',
    tournamentName: 'Orange Bowl',
    startDate: '2026-12-05',
    endDate: '2026-12-12',
    parentOrganisation: { organisationId: 'prov-1' },
    ...overrides,
  };
}

describe('PostgresTournamentStorage — owner_epoch fencing', () => {
  let pool: ReturnType<typeof makeMockPool>;
  let storage: PostgresTournamentStorage;

  beforeEach(() => {
    pool = makeMockPool();
    storage = new PostgresTournamentStorage(pool as any);
  });

  it('guards the write on the fencing predicate and persists the epoch', async () => {
    pool.query.mockResolvedValue({ rowCount: 1 });

    await storage.saveTournamentRecord({ tournamentRecord: record(), ownerEpoch: 7 });

    const [sql, params] = pool.query.mock.calls[0];
    // The predicate is the entire safety mechanism — assert it precisely rather
    // than asserting "an UPDATE happened".
    expect(sql).toContain('WHERE tournaments.owner_epoch <= EXCLUDED.owner_epoch');
    expect(sql).toContain('owner_epoch = EXCLUDED.owner_epoch');
    expect(params[6]).toBe(7);
  });

  it('defaults to epoch 0 rather than skipping the guard when no epoch is supplied', async () => {
    pool.query.mockResolvedValue({ rowCount: 1 });

    await storage.saveTournamentRecord({ tournamentRecord: record() });

    const [sql, params] = pool.query.mock.calls[0];
    // A3 — an absent field must not become a permissive default. There must be
    // no code path in which a missing epoch produces an unguarded write.
    expect(sql).toContain('WHERE tournaments.owner_epoch <= EXCLUDED.owner_epoch');
    expect(params[6]).toBe(0);
  });

  it('returns the distinct FENCED error when the predicate rejects the write', async () => {
    pool.query.mockResolvedValue({ rowCount: 0 });

    const result: any = await storage.saveTournamentRecord({ tournamentRecord: record(), ownerEpoch: 3 });

    expect(result.error).toBe(FENCED_BY_NEWER_OWNER);
    expect(result.fenced).toBe(true);
    expect(result.tournamentId).toBe('t-1');
    expect(result.success).toBeUndefined();
  });

  it('reports the byte size it already computed for the write', async () => {
    pool.query.mockResolvedValue({ rowCount: 1 });

    const tournamentRecord = record();
    const result: any = await storage.saveTournamentRecord({ tournamentRecord });

    expect(result.bytes).toBe(JSON.stringify(tournamentRecord).length);
  });

  it('logs the first fence rejection at ERROR and throttles the next ones', async () => {
    const errorSpy = vi.spyOn((storage as any).logger, 'error').mockImplementation(() => undefined);
    const debugSpy = vi.spyOn((storage as any).logger, 'debug').mockImplementation(() => undefined);
    pool.query.mockResolvedValue({ rowCount: 0 });

    await storage.saveTournamentRecord({ tournamentRecord: record(), ownerEpoch: 1 });
    await storage.saveTournamentRecord({ tournamentRecord: record(), ownerEpoch: 1 });

    // A2 — first failure loud, subsequent ones throttled until a milestone.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('FENCED');
    expect(debugSpy).toHaveBeenCalledTimes(1);
  });

  it('emits a recovery WARN on the first success after a fence rejection', async () => {
    const warnSpy = vi.spyOn((storage as any).logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn((storage as any).logger, 'error').mockImplementation(() => undefined);

    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    await storage.saveTournamentRecord({ tournamentRecord: record(), ownerEpoch: 1 });

    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    await storage.saveTournamentRecord({ tournamentRecord: record(), ownerEpoch: 9 });

    // A2 — without this the operator sees the failures but never the recovery.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('recovered after 1 rejection(s)');
  });

  it('does not emit a recovery WARN when there was nothing to recover from', async () => {
    const warnSpy = vi.spyOn((storage as any).logger, 'warn').mockImplementation(() => undefined);
    pool.query.mockResolvedValue({ rowCount: 1 });

    await storage.saveTournamentRecord({ tournamentRecord: record() });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('aborts the batch on the first fenced record and surfaces the fence', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
    vi.spyOn((storage as any).logger, 'error').mockImplementation(() => undefined);

    const result: any = await storage.saveTournamentRecords({
      tournamentRecords: {
        't-1': record({ tournamentId: 't-1' }),
        't-2': record({ tournamentId: 't-2' }),
      },
      ownerEpoch: 2,
    });

    expect(result.fenced).toBe(true);
    expect(result.tournamentId).toBe('t-2');
    // Only two writes attempted — the loop stops at the fenced record.
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('returns per-tournament byte sizes for a successful batch', async () => {
    pool.query.mockResolvedValue({ rowCount: 1 });

    const records = {
      't-1': record({ tournamentId: 't-1' }),
      't-2': record({ tournamentId: 't-2', tournamentName: 'Kalamazoo' }),
    };
    const result: any = await storage.saveTournamentRecords({ tournamentRecords: records });

    expect(result.bytes['t-1']).toBe(JSON.stringify(records['t-1']).length);
    expect(result.bytes['t-2']).toBe(JSON.stringify(records['t-2']).length);
  });
});
