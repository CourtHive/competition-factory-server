import { OutboundQueueService } from './outbound-queue.service';
import { QueueEntry } from './types/queue-entry';
import { RelayConfig } from './relay.config';
import { SenderService } from './sender.service';

// In-memory queue simulating the Postgres table
let rows: QueueEntry[] = [];
let nextSeq = 1;

const mockPool = {
  query: jest.fn(async (sql: string, params?: any[]) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes('CREATE TABLE')) return { rows: [] };

    if (text.includes('INSERT INTO outbound_relay_queue')) {
      const entry: QueueEntry = {
        sequence: nextSeq++,
        venueId: params![0],
        kind: params![1],
        matchUpId: params![2],
        payload: JSON.parse(params![3]),
        createdAt: new Date().toISOString(),
        attempts: 0,
      };
      rows.push(entry);
      return { rows: [entry] };
    }

    if (text.includes('SELECT COUNT')) {
      return { rows: [{ count: rows.length }] };
    }

    if (text.includes('SELECT sequence')) {
      const limit = params![0];
      return {
        rows: rows.slice(0, limit).map((e) => ({
          sequence: e.sequence,
          venue_id: e.venueId,
          kind: e.kind,
          match_up_id: e.matchUpId,
          payload: e.payload,
          created_at: e.createdAt,
          attempts: e.attempts,
          last_error: e.lastError ?? null,
        })),
      };
    }

    if (text.includes('DELETE FROM outbound_relay_queue')) {
      const seqs: number[] = params![0];
      rows = rows.filter((e) => !seqs.includes(e.sequence));
      return { rows: [] };
    }

    if (text.includes('UPDATE outbound_relay_queue')) {
      const entry = rows.find((e) => e.sequence === params![0]);
      if (entry) {
        entry.attempts += 1;
        entry.lastError = params![1];
      }
      return { rows: [] };
    }

    return { rows: [] };
  }),
};

describe('SenderService.drainOnce', () => {
  let queue: OutboundQueueService;
  let config: RelayConfig;
  let sender: SenderService;
  let fetchMock: jest.Mock;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    rows = [];
    nextSeq = 1;
    jest.clearAllMocks();
    process.env.INSTANCE_ROLE = 'local';
    process.env.LOCAL_VENUE_ID = 'venue-test';
    process.env.CLOUD_RELAY_URL = 'https://relay.example.test';
    process.env.CLOUD_RELAY_API_KEY = 'secret';
    process.env.CLOUD_RELAY_MAX_BATCH = '10';

    queue = new OutboundQueueService(mockPool as any);
    config = new RelayConfig();
    sender = new SenderService(config, queue);
    fetchMock = jest.fn(async () => ({ ok: true, status: 200 }) as any);
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    delete (globalThis as any).fetch;
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns 0/0 when queue empty', async () => {
    let result: any = await sender.drainOnce();
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends queued entries and acks them on success', async () => {
    await queue.enqueue({ venueId: 'venue-test', kind: 'bolt-history', matchUpId: 'm1', payload: { x: 1 } });
    await queue.enqueue({ venueId: 'venue-test', kind: 'bolt-history', matchUpId: 'm2', payload: { x: 2 } });

    let result: any = await sender.drainOnce();
    expect(result.sent).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://relay.example.test/api/cloud-ingest');
    expect(init.headers.Authorization).toBe('Bearer secret');
    const body = JSON.parse(init.body);
    expect(body.venueId).toBe('venue-test');
    expect(body.entries).toHaveLength(2);

    expect(await queue.depth()).toBe(0);
  });

  it('nacks entries on failure and leaves them in the queue', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as any);
    await queue.enqueue({ venueId: 'venue-test', kind: 'scorebug', matchUpId: 'm1', payload: 1 });

    let result: any = await sender.drainOnce();
    expect(result.failed).toBe(1);
    expect(await queue.depth()).toBe(1);
    const [entry] = await queue.peek(1);
    expect(entry.attempts).toBe(1);
    expect(entry.lastError).toMatch(/503/);
  });

  it('re-entry while draining is a no-op', async () => {
    await queue.enqueue({ venueId: 'venue-test', kind: 'bolt-history', matchUpId: 'm1', payload: 1 });
    (sender as any).draining = true;
    let result: any = await sender.drainOnce();
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
