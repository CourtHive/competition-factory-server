jest.mock('src/services/levelDB/netLevel', () => {
  const store = new Map<string, any>();
  return {
    __esModule: true,
    default: {
      get: jest.fn(async (_base: string, { key }: { key: string }) => store.get(key) ?? null),
      set: jest.fn(async (_base: string, { key, value }: { key: string; value: any }) => {
        store.set(key, value);
        return { success: true };
      }),
      delete: jest.fn(async (_base: string, { key }: { key: string }) => {
        store.delete(key);
        return { success: true };
      }),
      list: jest.fn(async () =>
        Array.from(store.entries()).map(([key, value]) => ({ key, value })),
      ),
      __reset: () => store.clear(),
    },
  };
});

import netLevelMock from 'src/services/levelDB/netLevel';
import { OutboundQueueService } from './outbound-queue.service';
import { RelayConfig } from './relay.config';
import { SenderService } from './sender.service';

describe('SenderService.drainOnce', () => {
  let queue: OutboundQueueService;
  let config: RelayConfig;
  let sender: SenderService;
  let fetchMock: jest.Mock;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    (netLevelMock as any).__reset();
    process.env.INSTANCE_ROLE = 'local';
    process.env.LOCAL_VENUE_ID = 'venue-test';
    process.env.CLOUD_RELAY_URL = 'https://relay.example.test';
    process.env.CLOUD_RELAY_API_KEY = 'secret';
    process.env.CLOUD_RELAY_MAX_BATCH = '10';

    queue = new OutboundQueueService();
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
    const result = await sender.drainOnce();
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends queued entries and acks them on success', async () => {
    await queue.enqueue({ venueId: 'venue-test', kind: 'bolt-history', matchUpId: 'm1', payload: { x: 1 } });
    await queue.enqueue({ venueId: 'venue-test', kind: 'bolt-history', matchUpId: 'm2', payload: { x: 2 } });

    const result = await sender.drainOnce();
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

    const result = await sender.drainOnce();
    expect(result.failed).toBe(1);
    expect(await queue.depth()).toBe(1);
    const [entry] = await queue.peek(1);
    expect(entry.attempts).toBe(1);
    expect(entry.lastError).toMatch(/503/);
  });

  it('re-entry while draining is a no-op', async () => {
    await queue.enqueue({ venueId: 'venue-test', kind: 'bolt-history', matchUpId: 'm1', payload: 1 });
    // Manually flip the draining flag to simulate concurrent invocation.
    (sender as any).draining = true;
    const result = await sender.drainOnce();
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
