import { executionQueue } from 'src/modules/factory/functions/private/executionQueue';
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

// C1 (statuses/2026-10-16-durable-outbox-recovery-review.md), end to end: a durable command holds ONE pool connection
// for its whole transaction, so anything inside it that asks the pool for a second one deadlocks a full pool. Here the
// pool has exactly one connection and a short acquire timeout, and the real queue runs through the real facade: the
// save reads the provider and upserts the calendar row, the participation index is rewritten, and a name change fires
// MODIFY_TOURNAMENT_DETAIL, whose calendar update is not awaited by the queue.
describe('durable command uses one connection through the storage facade', () => {
  const schema = `command_conn_${randomUUID().replace(/-/g, '')}`;
  const migrations = [
    '001-initial-schema.sql',
    '042-add-tournament-owner-epoch.sql',
    '045-add-participation-index.sql',
    '046-participation-issuing-organisation.sql',
    '047-add-calendar-tournaments.sql',
    '054-command-receipts.sql',
  ];
  let admin: Pool;
  let pool: Pool;
  let facade: TournamentStorageService;
  let receipts: CommandReceipts;

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
    const outbox: any = { isEnabled: false, enqueue: async () => ({ success: true }) };
    facade = new TournamentStorageService(
      new PostgresTournamentStorage(pool),
      new PostgresProviderStorage(pool),
      new PostgresCalendarStorage(pool),
      outbox,
      new PostgresParticipationStorage(pool),
    );
    receipts = new CommandReceipts(pool);
    const saved: any = await facade.saveTournamentRecord({
      tournamentRecord: {
        tournamentId: 'tc-1',
        tournamentName: 'Before',
        startDate: '2026-10-16',
        endDate: '2026-10-18',
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

  it('commits a calendar-listed save, its calendar row and the notice-driven calendar update', async () => {
    const methods = [{ method: 'setTournamentName', params: { tournamentName: 'After' } }];
    const command: any = {
      commandId: randomUUID(),
      commandActor: 'actor-a',
      tournamentIds: ['tc-1'],
      methods,
      rollbackOnError: true,
    };
    command.commandFingerprint = commandFingerprint(command);
    const result = await executionQueue(command, { commandReceipts: receipts }, facade);
    expect(result.success).toBe(true);
    expect(result.durableReceipt).toBe(true);
    const { tournamentRecord } = await facade.findTournamentRecord({ tournamentId: 'tc-1' });
    expect(tournamentRecord.tournamentName).toBe('After');
    const calendar = await pool.query('SELECT provider_id FROM calendar_tournaments WHERE tournament_id = $1', [
      'tc-1',
    ]);
    expect(calendar.rows).toEqual([{ provider_id: 'p-1' }]);
    expect((await pool.query('SELECT * FROM command_receipts')).rows).toHaveLength(1);
  });
});
