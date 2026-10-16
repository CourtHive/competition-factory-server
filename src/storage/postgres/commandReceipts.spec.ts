import { executionQueue } from 'src/modules/factory/functions/private/executionQueue';
import { PostgresTournamentStorage } from './postgres-tournament.storage';
import { commandFingerprint, CommandReceipts } from './commandReceipts';
import { PostgresProviderStorage } from './postgres-provider.storage';
import { afterCommandCommit } from './commandTransaction';
import { getPostgresConfig } from './postgres.config';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';

// Real Postgres in an isolated schema: shared-suite teardown cannot erase these records.
describe('durable command atomic commit and recovery', () => {
  const schema = `command_test_${randomUUID().replace(/-/g, '')}`;
  let admin: Pool;
  let pool: Pool;
  let storage: PostgresTournamentStorage;
  let receipts: CommandReceipts;
  const payload = (id = randomUUID(), actor = 'actor-a') => ({
    commandId: id,
    commandActor: actor,
    commandFingerprint: commandFingerprint({ tournamentIds: ['t1'], methods: [{ method: 'increment' }] }),
  });
  beforeAll(async () => {
    admin = new Pool(getPostgresConfig());
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ ...getPostgresConfig(), options: `-c search_path=${schema}` });
    for (const file of ['001-initial-schema.sql', '042-add-tournament-owner-epoch.sql', '054-command-receipts.sql']) {
      await pool.query(await readFile(join(__dirname, 'migrations', file), 'utf8'));
    }
    storage = new PostgresTournamentStorage(pool);
    receipts = new CommandReceipts(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE tournaments, command_receipts');
    await storage.saveTournamentRecord({ tournamentRecord: { tournamentId: 't1', count: 0 } });
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });
  const count = async () => (await storage.findTournamentRecord({ tournamentId: 't1' })).tournamentRecord.count;
  const increment = async () => {
    const { tournamentRecord } = await storage.findTournamentRecord({ tournamentId: 't1' });
    tournamentRecord.count++;
    const saved: any = await storage.saveTournamentRecord({ tournamentRecord });
    return {
      success: saved.success,
      appliedMethods: [{ method: 'canonical', params: { count: tournamentRecord.count } }],
    };
  };
  // C1 (statuses/2026-10-16-durable-outbox-recovery-review.md): a durable command holds ONE pool connection for its whole
  // transaction. A storage call inside it that asks the pool for a SECOND connection deadlocks a full pool: ten
  // concurrent commands each hold one and wait forever for another. The calendar update reads the provider inside the
  // transaction. With a one-connection pool, a second acquire times out instead of passing.
  it('never takes a second pool connection inside a durable command (provider read)', async () => {
    const single = new Pool({
      ...getPostgresConfig(),
      options: `-c search_path=${schema}`,
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    try {
      const providers = new PostgresProviderStorage(single as any);
      const result = await new CommandReceipts(single as any).execute(payload(), async () => {
        await providers.getProvider('p-1');
        return { success: true };
      });
      expect(result.success).toBe(true);
    } finally {
      await single.end();
    }
  });

  it('recovers the original canonical answer after a lost response and a new service instance', async () => {
    const command = payload();
    const first = await receipts.execute(command, increment); // answer is lost
    const answer = await new CommandReceipts(pool).execute(command, increment);
    expect(answer).toEqual({ ...first, deduplicated: true });
    expect(await count()).toBe(1);
  });
  it('serializes duplicate commands across concurrent connections', async () => {
    const command = payload();
    const results = await Promise.all([
      receipts.execute(command, increment),
      new CommandReceipts(pool).execute(command, increment),
    ]);
    expect(results.filter((result) => result.deduplicated)).toHaveLength(1);
    expect(await count()).toBe(1);
  });
  it('rolls back both a written record and receipt when a process dies before completion', async () => {
    const command = payload();
    await expect(
      receipts.execute(command, async () => {
        await increment();
        throw new Error('simulated crash before commit');
      }),
    ).rejects.toThrow('simulated crash');
    expect(await count()).toBe(0);
    expect((await pool.query('SELECT * FROM command_receipts')).rows).toHaveLength(0);
    await receipts.execute(command, increment);
    expect(await count()).toBe(1);
  });
  it('rolls back partial writes and deferred effects on an unsuccessful queue', async () => {
    const effect = vi.fn(async () => {});
    await receipts.execute(payload(), async () => {
      await increment();
      await afterCommandCommit(effect);
      return { error: 'refused' };
    });
    expect(await count()).toBe(0);
    expect(effect).not.toHaveBeenCalled();
  });
  it('rejects reuse for changed intent, and scopes keys to the authenticated actor', async () => {
    const command = payload();
    await receipts.execute(command, increment);
    await expect(receipts.execute({ ...command, commandFingerprint: 'f'.repeat(64) }, increment)).rejects.toThrow(
      'different intent',
    );
    await receipts.execute({ ...command, commandActor: 'actor-b' }, increment);
    expect(await count()).toBe(2);
  });
  it('runs external effects only after the receipt and record are committed, once', async () => {
    const command = payload();
    const effect = vi.fn(async () => {
      expect(await count()).toBe(1);
      expect((await pool.query('SELECT * FROM command_receipts')).rows).toHaveLength(1);
    });
    const apply = async () => {
      const result = await increment();
      await afterCommandCommit(effect);
      return result;
    };
    await receipts.execute(command, apply);
    await receipts.execute(command, apply);
    expect(effect).toHaveBeenCalledTimes(1);
  });
  it('refuses missing actor or invalid keys before applying anything', async () => {
    const apply = vi.fn(increment);
    await expect(receipts.execute({ ...payload(), commandActor: '' }, apply)).rejects.toThrow('Invalid durable');
    await expect(receipts.execute({ ...payload(), commandId: '../bad' }, apply)).rejects.toThrow('Invalid durable');
    expect(apply).not.toHaveBeenCalled();
  });
  it('hashes the same intent independent of transport metadata and object key order', () => {
    const a = { tournamentIds: ['t1'], methods: [{ method: 'm', params: { x: 1, y: 2 } }], ackId: 'a' };
    const b = { methods: [{ params: { y: 2, x: 1 }, method: 'm' }], tournamentIds: ['t1'], ackId: 'b' };
    expect(commandFingerprint(a)).toBe(commandFingerprint(b));
  });
  it('rolls back the record when writing its receipt fails', async () => {
    const command = payload();
    await pool.query('ALTER TABLE command_receipts ADD CONSTRAINT reject_receipt CHECK (false) NOT VALID');
    try {
      await expect(receipts.execute(command, increment)).rejects.toThrow();
      expect(await count()).toBe(0);
    } finally {
      await pool.query('ALTER TABLE command_receipts DROP CONSTRAINT reject_receipt');
    }
    await receipts.execute(command, increment);
    expect(await count()).toBe(1);
  });
  it('recovers a commit whose database reply was lost, without applying again', async () => {
    const command = payload();
    const original = pool.connect.bind(pool);
    const spy = vi.spyOn(pool, 'connect').mockImplementationOnce((async () => {
      const client = await original();
      return new Proxy(client, {
        get(target, key) {
          if (key === 'query')
            return async (sql: string, values?: any[]) => {
              const result = await target.query(sql, values);
              if (sql === 'COMMIT') throw new Error('commit reply lost');
              return result;
            };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }) as any);
    try {
      await expect(receipts.execute(command, increment)).rejects.toThrow('commit reply lost');
    } finally {
      spy.mockRestore();
    }
    const answer = await new CommandReceipts(pool).execute(command, increment);
    expect(answer.deduplicated).toBe(true);
    expect(await count()).toBe(1);
  });
  it('wires the real factory queue through atomic receipts, rather than only deduplicating a test callback', async () => {
    const methods = [{ method: 'setTournamentName', params: { tournamentName: 'After' } }];
    const command = { ...payload(), tournamentIds: ['t1'], methods, rollbackOnError: true };
    command.commandFingerprint = commandFingerprint(command);
    const save = vi.spyOn(storage, 'saveTournamentRecords');
    try {
      const first = await executionQueue(structuredClone(command), { commandReceipts: receipts }, storage as any);
      const replay = await executionQueue(structuredClone(command), { commandReceipts: receipts }, storage as any);
      expect(first.success).toBe(true);
      expect(first.durableReceipt).toBe(true);
      expect(replay.deduplicated).toBe(true);
      expect(save).toHaveBeenCalledTimes(1);
      expect((await storage.findTournamentRecord({ tournamentId: 't1' })).tournamentRecord.tournamentName).toBe(
        'After',
      );
    } finally {
      save.mockRestore();
    }
  });
  it('rolls back all linked records when one save is fenced', async () => {
    await storage.saveTournamentRecord({ tournamentRecord: { tournamentId: 't2', count: 0 }, ownerEpoch: 10 });
    const result = await receipts.execute(payload(), () =>
      storage.saveTournamentRecords({
        tournamentRecords: { t1: { tournamentId: 't1', count: 99 }, t2: { tournamentId: 't2', count: 99 } },
      }),
    );
    expect(result.fenced).toBe(true);
    expect(await count()).toBe(0);
    expect((await pool.query('SELECT * FROM command_receipts')).rows).toHaveLength(0);
  });
});
