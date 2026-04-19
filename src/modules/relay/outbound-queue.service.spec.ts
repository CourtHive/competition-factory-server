import { OutboundQueueService } from './outbound-queue.service';
import { QueueEntry } from './types/queue-entry';

// In-memory queue simulating the Postgres table
let rows: QueueEntry[] = [];
let nextSeq = 1;

const mockPool = {
  query: jest.fn(async (sql: string, params?: any[]) => {
    const text = sql.replace(/\s+/g, ' ').trim();

    if (text.includes('CREATE TABLE')) {
      return { rows: [] };
    }

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
      return { rows: rows.slice(0, limit).map(entryToRow) };
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

function entryToRow(e: QueueEntry) {
  return {
    sequence: e.sequence,
    venue_id: e.venueId,
    kind: e.kind,
    match_up_id: e.matchUpId,
    payload: e.payload,
    created_at: e.createdAt,
    attempts: e.attempts,
    last_error: e.lastError ?? null,
  };
}

describe('OutboundQueueService', () => {
  let queue: OutboundQueueService;

  beforeEach(() => {
    rows = [];
    nextSeq = 1;
    jest.clearAllMocks();
    queue = new OutboundQueueService(mockPool as any);
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
