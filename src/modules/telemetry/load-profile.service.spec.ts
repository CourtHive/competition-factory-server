import { LoadProfileService } from './load-profile.service';

function makeMockPool() {
  return { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
}

function makeService(pool: any, env: Record<string, string> = {}) {
  const previous = { ...process.env };
  process.env.LOAD_PROFILE_ENABLED = env.LOAD_PROFILE_ENABLED ?? 'true';
  if (env.LOAD_PROFILE_FLUSH_MS) process.env.LOAD_PROFILE_FLUSH_MS = env.LOAD_PROFILE_FLUSH_MS;
  const service = new LoadProfileService(pool);
  process.env = previous;
  return service;
}

const record = { tournamentId: 't-1', startDate: '2026-12-05', endDate: '2026-12-12' };
const sample = (overrides: any = {}) => ({
  tournamentId: 't-1',
  tournamentRecord: record,
  elapsedMs: 10,
  methodCount: 2,
  recordBytes: 1000,
  ...overrides,
});

describe('LoadProfileService', () => {
  let pool: ReturnType<typeof makeMockPool>;

  beforeEach(() => {
    pool = makeMockPool();
    vi.useFakeTimers().setSystemTime(new Date('2026-12-08T14:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('when disabled', () => {
    it('records nothing and never writes', async () => {
      const service = makeService(pool, { LOAD_PROFILE_ENABLED: 'false' });

      service.record(sample());
      await service.flush();

      expect(service.isEnabled).toBe(false);
      expect(pool.query).not.toHaveBeenCalled();
      expect(service.getStatus().bufferedBuckets).toBe(0);
    });
  });

  describe('when enabled', () => {
    it('aggregates repeated samples into a single hour bucket', async () => {
      const service = makeService(pool);

      service.record(sample({ elapsedMs: 10, recordBytes: 1000 }));
      service.record(sample({ elapsedMs: 30, recordBytes: 4000 }));

      expect(service.getStatus().bufferedBuckets).toBe(1);
      await service.flush();

      const [, params] = pool.query.mock.calls[0];
      // tournament_id, bucket_start, lifecycle_class, mutations, methods,
      // total_elapsed, max_elapsed, total_bytes, max_bytes, fenced
      expect(params[0]).toBe('t-1');
      expect(params[2]).toBe('live');
      expect(params[3]).toBe(2); // mutation_count
      expect(params[4]).toBe(4); // method_count
      expect(params[5]).toBe(40); // total_elapsed_ms
      expect(params[6]).toBe(30); // max_elapsed_ms — the tail, which a mean hides
      expect(params[7]).toBe(5000); // total_record_bytes
      expect(params[8]).toBe(4000); // max_record_bytes
    });

    it('separates buckets by lifecycle class', async () => {
      const service = makeService(pool);

      service.record(sample());
      service.record(sample({ tournamentRecord: { startDate: '2027-06-01', endDate: '2027-06-08' } }));

      expect(service.getStatus().bufferedBuckets).toBe(2);
    });

    it('counts fenced saves separately', async () => {
      const service = makeService(pool);

      service.record(sample({ fenced: true }));
      await service.flush();

      const [, params] = pool.query.mock.calls[0];
      expect(params[9]).toBe(1); // fenced_count
    });

    it('classifies a sample with no record as unknown rather than guessing', async () => {
      const service = makeService(pool);

      service.record(sample({ tournamentRecord: undefined }));
      await service.flush();

      expect(pool.query.mock.calls[0][1][2]).toBe('unknown');
    });

    it('drains the buffer before writing so a slow flush cannot double-count', async () => {
      const service = makeService(pool);
      service.record(sample());

      await service.flush();
      expect(service.getStatus().bufferedBuckets).toBe(0);

      await service.flush();
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('never throws from record() on the mutation hot path', () => {
      const service = makeService(pool);

      expect(() => service.record(sample({ tournamentId: undefined }))).not.toThrow();
      expect(() => service.record(null as any)).not.toThrow();
      expect(service.getStatus().bufferedBuckets).toBe(0);
    });
  });

  describe('flush failure handling (A2)', () => {
    it('restores the window and counts the failure without throwing', async () => {
      pool.query.mockRejectedValue(new Error('connection terminated'));
      const service = makeService(pool);
      const errorSpy = vi.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      service.record(sample());
      await expect(service.flush()).resolves.toBeUndefined();

      // The window survives a transient error rather than being discarded.
      expect(service.getStatus().bufferedBuckets).toBe(1);
      expect(service.getStatus().flushFailures).toBe(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('merges restored buckets with samples recorded during the failed flush', async () => {
      pool.query.mockRejectedValueOnce(new Error('down'));
      const service = makeService(pool);
      vi.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      service.record(sample({ elapsedMs: 10 }));
      await service.flush();
      service.record(sample({ elapsedMs: 5 }));

      pool.query.mockResolvedValue({ rowCount: 1 });
      await service.flush();

      const [, params] = pool.query.mock.calls[1];
      expect(params[3]).toBe(2); // both mutations survived
      expect(params[5]).toBe(15); // summed elapsed
    });

    it('emits a recovery WARN on the first successful flush after failures', async () => {
      pool.query.mockRejectedValueOnce(new Error('down'));
      const service = makeService(pool);
      vi.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

      service.record(sample());
      await service.flush();

      pool.query.mockResolvedValue({ rowCount: 1 });
      await service.flush();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('recovered after 1 failure(s)');
      expect(service.getStatus().flushFailures).toBe(0);
    });

    it('bounds the buffer so a persistently stuck flush cannot exhaust the heap', async () => {
      pool.query.mockRejectedValue(new Error('down'));
      const service = makeService(pool);
      vi.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      const max = service.getStatus().maxBufferedBuckets;
      for (let i = 0; i < max + 10; i++) {
        service.record(sample({ tournamentId: `t-${i}` }));
      }

      expect(service.getStatus().bufferedBuckets).toBe(max);
      expect(service.getStatus().droppedSamples).toBe(10);
    });
  });
});
