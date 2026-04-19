import { MutationMirrorService, MirrorQueueEntry } from './mutation-mirror.service';
import { RelayConfig } from '../relay/relay.config';

// In-memory queue that simulates the Postgres table
let queue: MirrorQueueEntry[] = [];
let nextSeq = 1;

const mockPool = {
  query: jest.fn(async (sql: string, params?: any[]) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes('CREATE TABLE')) {
      return { rows: [] };
    }

    if (text.includes('INSERT INTO mutation_mirror_queue')) {
      const entry: MirrorQueueEntry = {
        sequence: nextSeq++,
        tournamentIds: params![0],
        methods: JSON.parse(params![1]),
        createdAt: new Date().toISOString(),
        attempts: 0,
      };
      queue.push(entry);
      return { rows: [entry] };
    }

    if (text.includes('SELECT COUNT')) {
      return { rows: [{ count: queue.length }] };
    }

    if (text.includes('SELECT sequence')) {
      const limit = params![0];
      const rows = queue.slice(0, limit).map((e) => ({
        sequence: e.sequence,
        tournament_ids: e.tournamentIds,
        methods: e.methods,
        created_at: e.createdAt,
        attempts: e.attempts,
        last_error: e.lastError ?? null,
      }));
      return { rows };
    }

    if (text.includes('DELETE FROM mutation_mirror_queue')) {
      queue = queue.filter((e) => e.sequence !== params![0]);
      return { rows: [] };
    }

    if (text.includes('UPDATE mutation_mirror_queue')) {
      const entry = queue.find((e) => e.sequence === params![0]);
      if (entry) {
        entry.attempts += 1;
        entry.lastError = params![1];
      }
      return { rows: [] };
    }

    return { rows: [] };
  }),
};

const originalFetch = global.fetch;

describe('MutationMirrorService', () => {
  const ORIGINAL = { ...process.env };
  let service: MutationMirrorService;

  beforeEach(async () => {
    process.env.UPSTREAM_SERVER_URL = 'https://cloud.example.test';
    process.env.UPSTREAM_API_KEY = 'mirror-key-123';
    const config = new RelayConfig();
    service = new MutationMirrorService(config, mockPool as any);

    queue = [];
    nextSeq = 1;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    global.fetch = originalFetch;
    service.onModuleDestroy();
  });

  describe('enqueue', () => {
    it('enqueues a mutation payload', async () => {
      await service.enqueue({
        tournamentIds: ['t1'],
        methods: [{ method: 'setTournamentDates', params: { startDate: '2026-01-01' } }],
      });

      let result: any = await service.depth();
      expect(result).toBe(1);
    });

    it('preserves sequence ordering across multiple enqueues', async () => {
      await service.enqueue({ tournamentIds: ['t1'], methods: [{ method: 'a' }] });
      await service.enqueue({ tournamentIds: ['t2'], methods: [{ method: 'b' }] });
      await service.enqueue({ tournamentIds: ['t3'], methods: [{ method: 'c' }] });

      let result: any = await service.depth();
      expect(result).toBe(3);
    });
  });

  describe('drainOnce', () => {
    it('sends enqueued mutations to upstream', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      await service.enqueue({
        tournamentIds: ['t1'],
        methods: [{ method: 'setTournamentDates', params: {} }],
      });

      let result: any = await service.drainOnce();
      expect(result.sent).toBe(1);
      expect(result.failed).toBe(0);

      // Queue should be empty after drain
      expect(await service.depth()).toBe(0);

      // Verify fetch was called with correct URL and auth
      expect(global.fetch).toHaveBeenCalledWith(
        'https://cloud.example.test/factory',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mirror-key-123',
          }),
        }),
      );
    });

    it('returns zero when queue is empty', async () => {
      let result: any = await service.drainOnce();
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('nacks and stops on failure — preserves ordering', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await service.enqueue({ tournamentIds: ['t1'], methods: [{ method: 'a' }] });
      await service.enqueue({ tournamentIds: ['t2'], methods: [{ method: 'b' }] });

      let result: any = await service.drainOnce();
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(1);

      // Both entries still in queue (stopped after first failure)
      expect(await service.depth()).toBe(2);
    });

    it('drains multiple entries in sequence order', async () => {
      const postBodies: any[] = [];
      global.fetch = jest.fn().mockImplementation(async (_url, opts) => {
        postBodies.push(JSON.parse(opts.body));
        return { ok: true };
      });

      await service.enqueue({ tournamentIds: ['t1'], methods: [{ method: 'first' }] });
      await service.enqueue({ tournamentIds: ['t2'], methods: [{ method: 'second' }] });

      let result: any = await service.drainOnce();
      expect(result.sent).toBe(2);
      expect(postBodies[0].methods[0].method).toBe('first');
      expect(postBodies[1].methods[0].method).toBe('second');
    });

    it('increments attempts on nack', async () => {
      global.fetch = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ ok: true });

      await service.enqueue({ tournamentIds: ['t1'], methods: [{ method: 'a' }] });

      // First drain: fails
      await service.drainOnce();
      expect(await service.depth()).toBe(1);
      expect(queue[0].attempts).toBe(1);

      // Second drain: succeeds
      let result: any = await service.drainOnce();
      expect(result.sent).toBe(1);
      expect(await service.depth()).toBe(0);
    });
  });
});
