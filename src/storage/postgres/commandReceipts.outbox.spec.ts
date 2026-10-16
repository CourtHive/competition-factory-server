import { executionQueue } from 'src/modules/factory/functions/private/executionQueue';
import { PostgresProjectionOutboxStorage } from './postgres-projection-outbox.storage';
import { PostgresParticipationStorage } from './postgres-participation.storage';
import { TournamentStorageService } from '../tournament-storage.service';
import { PostgresTournamentStorage } from './postgres-tournament.storage';
import { PostgresCalendarStorage } from './postgres-calendar.storage';
import { PostgresProviderStorage } from './postgres-provider.storage';
import { commandFingerprint, CommandReceipts } from './commandReceipts';
import { getPostgresConfig } from './postgres.config';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';

// C2 (statuses/2026-10-16-durable-outbox-recovery-review.md): a durable command's projection deltas are enqueued on the
// command's own connection, so they commit with the record and its receipt. Before, they were written after COMMIT,
// and a crash in between lost them until reconciliation. One-connection pool: the enqueue must not take a second one.
describe('durable command transactional outbox', () => {
  const schema = `command_outbox_${randomUUID().replace(/-/g, '')}`;
  const migrations = [
    '001-initial-schema.sql',
    '039-add-projection-outbox.sql',
    '042-add-tournament-owner-epoch.sql',
    '045-add-participation-index.sql',
    '046-participation-issuing-organisation.sql',
    '047-add-calendar-tournaments.sql',
    '054-command-receipts.sql',
    '055-projection-snapshot-id-and-requests.sql',
  ];
  let admin: Pool;
  let pool: Pool;
  let facade: TournamentStorageService;
  let outbox: PostgresProjectionOutboxStorage;
  let receipts: CommandReceipts;

  const command = (tournamentName: string) => {
    const methods = [{ method: 'setTournamentName', params: { tournamentName } }];
    const sent: any = { commandId: randomUUID(), commandActor: 'actor-a', tournamentIds: ['to-1'], methods };
    sent.commandFingerprint = commandFingerprint(sent);
    return sent;
  };
  const run = (sent: any) =>
    executionQueue(structuredClone(sent), { commandReceipts: receipts, projectionOutbox: outbox }, facade);
  const queued = async () =>
    Number((await admin.query(`SELECT count(*) FROM ${schema}.projection_queue`)).rows[0].count);
  const receiptCount = async () =>
    Number((await admin.query(`SELECT count(*) FROM ${schema}.command_receipts`)).rows[0].count);
  const storedName = async () =>
    (
      await admin.query(
        `SELECT data->>'tournamentName' AS name FROM ${schema}.tournaments WHERE tournament_id = 'to-1'`,
      )
    ).rows[0].name;

  beforeAll(async () => {
    admin = new Pool(getPostgresConfig());
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      ...getPostgresConfig(),
      options: `-c search_path=${schema}`,
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    for (const file of migrations) await pool.query(await readFile(join(__dirname, 'migrations', file), 'utf8'));
    await pool.query(
      `INSERT INTO providers (provider_id, organisation_abbreviation, organisation_name, data) VALUES ($1, $2, $3, '{}')`,
      ['p-1', 'P1', 'Provider One'],
    );
    const previous = process.env.PROJECTION_OUTBOX_ENABLED;
    process.env.PROJECTION_OUTBOX_ENABLED = 'true';
    outbox = new PostgresProjectionOutboxStorage(pool);
    if (previous === undefined) delete process.env.PROJECTION_OUTBOX_ENABLED;
    else process.env.PROJECTION_OUTBOX_ENABLED = previous;
    expect(outbox.isEnabled).toBe(true);
    facade = new TournamentStorageService(
      new PostgresTournamentStorage(pool),
      new PostgresProviderStorage(pool),
      new PostgresCalendarStorage(pool),
      outbox,
      new PostgresParticipationStorage(pool),
    );
    receipts = new CommandReceipts(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE tournaments, command_receipts, projection_queue');
    const saved: any = await facade.saveTournamentRecord({
      tournamentRecord: {
        tournamentId: 'to-1',
        tournamentName: 'Before',
        startDate: '2026-10-16',
        parentOrganisation: { organisationId: 'p-1' },
      },
    });
    expect(saved.success).toBe(true);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  it('commits the deltas with the record and the receipt', async () => {
    const result = await run(command('After'));
    expect(result.success).toBe(true);
    expect(await storedName()).toBe('After');
    expect(await receiptCount()).toBe(1);
    expect(await queued()).toBeGreaterThan(0);
  });

  it('keeps the deltas of a command whose COMMIT reply was lost', async () => {
    const original = pool.connect.bind(pool);
    const spy = vi.spyOn(pool, 'connect').mockImplementationOnce((async () => {
      const client = await original();
      return new Proxy(client, {
        get(target, key) {
          if (key === 'query')
            return async (sql: any, values?: any[]) => {
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
      await expect(run(command('After'))).rejects.toThrow('outcome uncertain');
    } finally {
      spy.mockRestore();
    }
    // No post-commit effect ran, yet the read model still learns of the committed record.
    expect(await storedName()).toBe('After');
    expect(await queued()).toBeGreaterThan(0);
  });

  it('rolls the deltas back with a command that does not commit', async () => {
    await admin.query(`ALTER TABLE ${schema}.command_receipts ADD CONSTRAINT reject_receipt CHECK (false) NOT VALID`);
    try {
      await expect(run(command('After'))).rejects.toThrow();
    } finally {
      await admin.query(`ALTER TABLE ${schema}.command_receipts DROP CONSTRAINT reject_receipt`);
    }
    expect(await storedName()).toBe('Before');
    expect(await queued()).toBe(0);
  });

  it('commits the command when its span fails to enqueue', async () => {
    await admin.query(`ALTER TABLE ${schema}.projection_queue ADD CONSTRAINT reject_span CHECK (false) NOT VALID`);
    try {
      const result = await run(command('After'));
      expect(result.success).toBe(true);
    } finally {
      await admin.query(`ALTER TABLE ${schema}.projection_queue DROP CONSTRAINT reject_span`);
    }
    expect(await storedName()).toBe('After');
    expect(await receiptCount()).toBe(1);
    expect(await queued()).toBe(0);
  });
});
