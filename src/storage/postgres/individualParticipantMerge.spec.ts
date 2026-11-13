import { PostgresProjectionOutboxStorage } from './postgres-projection-outbox.storage';
import { executionQueue } from 'src/modules/factory/functions/private/executionQueue';
import { PostgresParticipationStorage } from './postgres-participation.storage';
import { PostgresTournamentStorage } from './postgres-tournament.storage';
import { TournamentStorageService } from '../tournament-storage.service';
import { commandFingerprint, CommandReceipts } from './commandReceipts';
import { PostgresCalendarStorage } from './postgres-calendar.storage';
import { PostgresProviderStorage } from './postgres-provider.storage';
import { participantGovernor } from 'tods-competition-factory';
import { getPostgresConfig } from './postgres.config';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';

// Exercise the actual command path: record, aliases, protected receipt and projection outbox must commit or
// roll back together. A one-connection pool also proves outbox writes reuse the command's transaction.
describe('individual merge durable persistence', () => {
  const schema = `individual_merge_${randomUUID().replace(/-/g, '')}`;
  const migrations = [
    '001-initial-schema.sql',
    '039-add-projection-outbox.sql',
    '042-add-tournament-owner-epoch.sql',
    '045-add-participation-index.sql',
    '046-participation-issuing-organisation.sql',
    '047-add-calendar-tournaments.sql',
    '054-command-receipts.sql',
    '055-projection-snapshot-id-and-requests.sql',
    '061-tournament-storage-layout.sql',
  ];
  let admin: Pool;
  let pool: Pool;
  let facade: TournamentStorageService;
  let outbox: PostgresProjectionOutboxStorage;
  let receipts: CommandReceipts;

  const command = async () => {
    const fetched: any = await facade.fetchTournamentRecords({ tournamentIds: ['to-1'] });
    const tournamentRecord = fetched.tournamentRecords['to-1'];
    const args = { tournamentRecord, sourceParticipantId: 'source', targetParticipantId: 'target' };
    const preview: any = (participantGovernor as any).getIndividualParticipantMergePreview(args);
    const methods = [
      {
        method: 'mergeIndividualParticipants',
        params: {
          sourceParticipantId: 'source',
          targetParticipantId: 'target',
          expectedFingerprint: preview.fingerprint,
        },
      },
    ];
    const sent: any = {
      commandId: randomUUID(),
      commandActor: 'actor-a',
      tournamentIds: ['to-1'],
      methods,
      rollbackOnError: true,
    };
    sent.commandFingerprint = commandFingerprint(sent);
    return sent;
  };
  const run = (sent: any) =>
    executionQueue(structuredClone(sent), { commandReceipts: receipts, projectionOutbox: outbox }, facade);
  const queued = async () =>
    Number((await admin.query(`SELECT count(*) FROM ${schema}.projection_queue`)).rows[0].count);
  const receiptCount = async () =>
    Number((await admin.query(`SELECT count(*) FROM ${schema}.command_receipts`)).rows[0].count);
  const storedRecord = async () =>
    (await admin.query(`SELECT data FROM ${schema}.tournaments WHERE tournament_id = 'to-1'`)).rows[0].data;

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
        participants: ['source', 'target'].map((participantId) => ({
          participantId,
          participantType: 'INDIVIDUAL',
          participantRole: 'COMPETITOR',
          participantName: 'Ana Rivas',
          person: {
            personId: '00000000-0000-4000-8000-000000000001',
            standardGivenName: 'Ana',
            standardFamilyName: 'Rivas',
          },
        })),
      },
    });
    expect(saved.success).toBe(true);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  it('commits the merge, aliases, protected before-state and outbox once across an acknowledgement retry', async () => {
    const sent = await command();
    let result: any = await run(sent);
    expect(result.success).toBe(true);
    // The before-state is recovery evidence for the receipt only; the acknowledgement never carries it.
    expect(result.results[0].changedPaths).toBeDefined();
    expect(result.results[0]).not.toHaveProperty('mergeReceipt');
    const record = await storedRecord();
    expect(record.participants.map((p: any) => p.participantId)).toEqual(['target']);
    expect(record.extensions.find((e: any) => e.name === 'individualParticipantMerges').value.aliases.source).toBe(
      'target',
    );
    const saved = (await admin.query(`SELECT result FROM ${schema}.command_receipts`)).rows[0].result;
    expect(saved.results[0].mergeReceipt.before.participants.some((p: any) => p.participantId === 'source')).toBe(true);
    expect(await queued()).toBeGreaterThan(0);
    result = await run(sent);
    expect(result.deduplicated).toBe(true);
    expect(result.results[0]).not.toHaveProperty('mergeReceipt');
    expect(await receiptCount()).toBe(1);
    expect((await storedRecord()).participants).toHaveLength(1);
  });

  it('rolls back the record, mappings, receipt and projection when receipt persistence fails', async () => {
    await admin.query(`ALTER TABLE ${schema}.command_receipts ADD CONSTRAINT reject_receipt CHECK (false) NOT VALID`);
    try {
      await expect(run(await command())).rejects.toThrow();
    } finally {
      await admin.query(`ALTER TABLE ${schema}.command_receipts DROP CONSTRAINT reject_receipt`);
    }
    const record = await storedRecord();
    expect(record.participants).toHaveLength(2);
    expect(record.extensions?.some((e: any) => e.name === 'individualParticipantMerges') ?? false).toBe(false);
    expect(await receiptCount()).toBe(0);
    expect(await queued()).toBe(0);
  });
});
