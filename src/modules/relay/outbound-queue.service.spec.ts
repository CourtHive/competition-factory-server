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

describe('OutboundQueueService', () => {
  let queue: OutboundQueueService;

  beforeEach(() => {
    (netLevelMock as any).__reset();
    queue = new OutboundQueueService();
  });

  it('assigns monotonically increasing sequences', async () => {
    await queue.enqueue({ venueId: 'v1', kind: 'bolt-history', matchUpId: 'm1', payload: { a: 1 } });
    await queue.enqueue({ venueId: 'v1', kind: 'bolt-history', matchUpId: 'm2', payload: { a: 2 } });
    await queue.enqueue({ venueId: 'v1', kind: 'bolt-history', matchUpId: 'm3', payload: { a: 3 } });

    const all = await queue.peek(10);
    expect(all.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(all.map((e) => e.matchUpId)).toEqual(['m1', 'm2', 'm3']);
  });

  it('peek respects the limit', async () => {
    for (let i = 0; i < 5; i++) {
      await queue.enqueue({ venueId: 'v1', kind: 'scorebug', matchUpId: `m${i}`, payload: i });
    }
    const peeked = await queue.peek(2);
    expect(peeked).toHaveLength(2);
    expect(peeked.map((e) => e.sequence)).toEqual([1, 2]);
  });

  it('ack removes acknowledged entries', async () => {
    await queue.enqueue({ venueId: 'v1', kind: 'bolt-history', matchUpId: 'a', payload: 1 });
    await queue.enqueue({ venueId: 'v1', kind: 'bolt-history', matchUpId: 'b', payload: 2 });
    await queue.ack([1]);
    const remaining = await queue.peek(10);
    expect(remaining.map((e) => e.matchUpId)).toEqual(['b']);
  });

  it('nack increments attempts and records lastError', async () => {
    await queue.enqueue({ venueId: 'v1', kind: 'video-board', matchUpId: 'a', payload: 1 });
    await queue.nack(1, 'connection refused');
    const [entry] = await queue.peek(1);
    expect(entry.attempts).toBe(1);
    expect(entry.lastError).toBe('connection refused');
  });

  it('depth reports remaining entries', async () => {
    await queue.enqueue({ venueId: 'v1', kind: 'bolt-history', matchUpId: 'a', payload: 1 });
    await queue.enqueue({ venueId: 'v1', kind: 'bolt-history', matchUpId: 'b', payload: 2 });
    expect(await queue.depth()).toBe(2);
    await queue.ack([1]);
    expect(await queue.depth()).toBe(1);
  });
});
