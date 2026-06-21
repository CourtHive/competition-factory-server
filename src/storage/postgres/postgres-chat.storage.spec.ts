import { PostgresChatStorage } from './postgres-chat.storage';

function makePool(rows: any[] = [], rowCount?: number) {
  return { query: jest.fn().mockResolvedValue({ rows, rowCount: rowCount ?? rows.length }) } as any;
}

const dbRow = (over: Partial<Record<string, any>> = {}) => ({
  seq: '7',
  tournament_id: 't1',
  provider_id: 'prov-1',
  provider_abbr: 'ACME',
  tournament_name: 'Open',
  user_name: 'alice',
  message: 'hi',
  client_msg_id: 'c1',
  is_admin: false,
  created_at: new Date('2026-06-20T00:00:00.000Z'),
  ...over,
});

describe('PostgresChatStorage', () => {
  it('appendMessage inserts and maps the returned row (seq → number)', async () => {
    const pool = makePool([dbRow()]);
    const storage = new PostgresChatStorage(pool);

    const { record } = await storage.appendMessage({ tournamentId: 't1', userName: 'alice', message: 'hi', clientMsgId: 'c1' });

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO chat_messages'), expect.any(Array));
    expect(record).toMatchObject({ seq: 7, tournamentId: 't1', userName: 'alice', message: 'hi', clientMsgId: 'c1', isAdmin: false });
    expect(typeof record!.seq).toBe('number');
    expect(record!.createdAt).toBe('2026-06-20T00:00:00.000Z');
  });

  it('appendMessage returns an error string on failure', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('db down')) } as any;
    const storage = new PostgresChatStorage(pool);
    const { record, error } = await storage.appendMessage({ tournamentId: 't1', userName: 'a', message: 'x' });
    expect(record).toBeUndefined();
    expect(error).toBe('db down');
  });

  it('recentMessages maps rows', async () => {
    const pool = makePool([dbRow({ seq: '3' }), dbRow({ seq: '5' })]);
    const storage = new PostgresChatStorage(pool);
    const { records } = await storage.recentMessages({ tournamentId: 't1' });
    expect(records!.map((r) => r.seq)).toEqual([3, 5]);
  });

  it('messagesSince passes afterSeq through', async () => {
    const pool = makePool([]);
    const storage = new PostgresChatStorage(pool);
    await storage.messagesSince({ tournamentId: 't1', afterSeq: 42 });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('seq > $2'), ['t1', 42, expect.any(Number)]);
  });

  it('pruneOlderThan returns the deleted count', async () => {
    const pool = makePool([], 9);
    const storage = new PostgresChatStorage(pool);
    const { deleted } = await storage.pruneOlderThan({ olderThanMs: 1000 });
    expect(deleted).toBe(9);
  });
});
