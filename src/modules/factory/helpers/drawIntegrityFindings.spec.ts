import { Logger } from '@nestjs/common';
import {
  DrawIntegrityFindingsService,
  FINDINGS_RETRY_MS,
  MAX_FINDING_ROWS_PER_WRITE,
  MAX_QUEUED_FINDING_ROWS,
  SEED_TIMEOUT_MS,
} from './drawIntegrityFindings';

// constants and types
import type { DrawIntegrityFindingRow } from 'src/storage/interfaces';

const row = (index = 0, over: Partial<DrawIntegrityFindingRow> = {}): DrawIntegrityFindingRow => ({
  tournamentId: 't1',
  drawId: 'd1',
  event: 'introduced',
  code: 'DANGLING_LINK',
  severity: 'error',
  fingerprint: `f${index}`,
  methods: ['setMatchUpStatus'],
  observedAt: '2026-10-23T00:00:00.000Z',
  ...over,
});

function fakeStorage() {
  return {
    append: vi.fn<(rows: DrawIntegrityFindingRow[]) => Promise<void>>(async () => undefined),
    loadOpenFindings: vi.fn(async () => ({ known: false, open: [] as any[] })),
  };
}

const lines = (spy: any) =>
  spy.mock.calls.filter(([, context]) => context === 'DrawIntegrity').map(([line]) => JSON.parse(line));

const nextTurn = () => new Promise(setImmediate);

/** Let the flush record() scheduled run to the end, without starting another. */
const settle = async () => {
  await nextTurn();
  await nextTurn();
};

describe('DrawIntegrityFindingsService', () => {
  const previousMode = process.env.DRAW_INTEGRITY_MODE;
  let warn: any;

  beforeEach(() => {
    delete process.env.DRAW_INTEGRITY_MODE;
    warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  afterAll(() => {
    if (previousMode === undefined) delete process.env.DRAW_INTEGRITY_MODE;
    else process.env.DRAW_INTEGRITY_MODE = previousMode;
  });

  it('record() only queues: the write happens on a later turn, and the rows arrive in order', async () => {
    const storage = fakeStorage();
    const service = new DrawIntegrityFindingsService(storage);
    service.record([row(1), row(2)]);
    service.record([row(3)]);
    expect(storage.append).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({ queued: 3, recorded: 3 });

    await nextTurn();
    await service.flush();
    expect(storage.append).toHaveBeenCalledTimes(1);
    expect(storage.append.mock.calls[0][0].map((r) => r.fingerprint)).toEqual(['f1', 'f2', 'f3']);
    expect(service.getStatus()).toMatchObject({ queued: 0, written: 3 });
  });

  it(`writes in batches of at most ${MAX_FINDING_ROWS_PER_WRITE}`, async () => {
    const storage = fakeStorage();
    const service = new DrawIntegrityFindingsService(storage);
    service.record(Array.from({ length: MAX_FINDING_ROWS_PER_WRITE + 1 }, (_, index) => row(index)));
    await service.flush();
    expect(storage.append.mock.calls.map(([rows]) => rows.length)).toEqual([MAX_FINDING_ROWS_PER_WRITE, 1]);
  });

  it.each([['off'], [' OFF ']])('DRAW_INTEGRITY_MODE=%j writes nothing', async (mode) => {
    process.env.DRAW_INTEGRITY_MODE = mode;
    const storage = fakeStorage();
    const service = new DrawIntegrityFindingsService(storage);
    service.record([row()]);
    await service.flush();
    expect(storage.append).not.toHaveBeenCalled();
    expect(service.getStatus().recorded).toBe(0);
  });

  it('a failed write keeps its rows, is counted and logged once, retries, and logs its recovery', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const storage = fakeStorage();
    storage.append.mockRejectedValueOnce(new Error('db down')).mockRejectedValueOnce(new Error('db down'));
    const service = new DrawIntegrityFindingsService(storage);

    service.record([row(1)]);
    await settle(); // the flush record() scheduled
    expect(service.getStatus()).toMatchObject({ queued: 1, writeFailures: 1, written: 0 });
    service.record([row(2)]); // a later change triggers a retry too
    await settle();
    expect(service.getStatus()).toMatchObject({ queued: 2, writeFailures: 2 });
    expect(lines(warn)).toEqual([
      expect.objectContaining({ event: 'draw-integrity-findings-write-failed', writeFailures: 1, rows: 1 }),
    ]);

    await vi.advanceTimersByTimeAsync(FINDINGS_RETRY_MS);
    await service.flush();
    expect(service.getStatus()).toMatchObject({ queued: 0, written: 2 });
    // The failed batch is retried FIRST: a finding's first row is the one the seed and the alert need.
    expect(storage.append.mock.lastCall?.[0].map((r) => r.fingerprint)).toEqual(['f1', 'f2']);
    expect(lines(warn).at(-1)).toEqual(
      expect.objectContaining({ event: 'draw-integrity-findings-write-recovered', afterFailures: 2 }),
    );
  });

  it(`holds at most ${MAX_QUEUED_FINDING_ROWS} rows while the database is down, and says what it dropped`, async () => {
    const storage = fakeStorage();
    storage.append.mockRejectedValue(new Error('db down'));
    const service = new DrawIntegrityFindingsService(storage);
    service.record(Array.from({ length: MAX_QUEUED_FINDING_ROWS + 7 }, (_, index) => row(index)));
    await service.flush();
    expect(service.getStatus()).toMatchObject({ queued: MAX_QUEUED_FINDING_ROWS, dropped: 7 });
    expect(lines(warn)).toEqual(
      expect.arrayContaining([expect.objectContaining({ event: 'draw-integrity-findings-dropped', dropped: 7 })]),
    );
    await service.onModuleDestroy();
  });

  it('loadOpen() writes what is queued before it reads, so a draw read back sees this process’s own rows', async () => {
    const order: string[] = [];
    const storage = fakeStorage();
    storage.append.mockImplementation(async () => {
      order.push('append');
    });
    storage.loadOpenFindings.mockImplementation(async () => {
      order.push('read');
      return { known: true, open: [] };
    });
    const service = new DrawIntegrityFindingsService(storage);
    service.record([row()]);
    await expect(service.loadOpen('t1', 'd1')).resolves.toEqual({ known: true, open: [] });
    expect(order).toEqual(['append', 'read']);
    expect(storage.loadOpenFindings).toHaveBeenCalledWith('t1', 'd1');
  });

  it(`loadOpen() gives up after ${SEED_TIMEOUT_MS}ms`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const storage = fakeStorage();
    storage.loadOpenFindings.mockImplementation(() => new Promise(() => undefined));
    const service = new DrawIntegrityFindingsService(storage);
    const read = service.loadOpen('t1', 'd1');
    const settled = expect(read).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(SEED_TIMEOUT_MS);
    await settled;
  });

  it('a graceful shutdown writes what is queued', async () => {
    const storage = fakeStorage();
    const service = new DrawIntegrityFindingsService(storage);
    service.record([row()]);
    await service.onModuleDestroy();
    expect(storage.append).toHaveBeenCalledTimes(1);
  });
});
