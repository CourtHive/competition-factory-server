import { PostgresProjectionOutboxStorage } from 'src/storage/postgres/postgres-projection-outbox.storage';
import { PostgresParticipationStorage } from 'src/storage/postgres/postgres-participation.storage';
import { PostgresTournamentStorage } from 'src/storage/postgres/postgres-tournament.storage';
import { PostgresCalendarStorage } from 'src/storage/postgres/postgres-calendar.storage';
import { PostgresProviderStorage } from 'src/storage/postgres/postgres-provider.storage';
import { MutationServicesService } from '../mutation-services/mutation-services.service';
import { CommandReceipts, saveFingerprint } from 'src/storage/postgres/commandReceipts';
import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { getPostgresConfig } from 'src/storage/postgres/postgres.config';
import { SUPER_ADMIN } from 'src/common/constants/roles';
import { FactoryService } from './factory.service';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';

const USER = { roles: [SUPER_ADMIN], email: 'sa@test.com', userId: 'u-1' };

// C3 (statuses/2026-10-16-durable-outbox-recovery-review.md): a wholesale save TMX acts on (go-online, claim) used to
// sit outside the receipt protocol. A resend after a lost answer replaced the whole record again, overwriting anything
// that landed in between. With a commandId the resend returns the original answer; with expectedServerUpdatedAt a
// record written since the caller read it is refused (409) instead of overwritten. Real Postgres, one-connection pool.
describe('FactoryService.saveTournamentRecords — durable and conditional', () => {
  const schema = `save_durable_${randomUUID().replace(/-/g, '')}`;
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
  let service: FactoryService;
  const previousEnv = { outbox: process.env.PROJECTION_OUTBOX_ENABLED, mode: process.env.PROJECTION_SNAPSHOT_MODE };

  const record = (tournamentName: string) => ({
    tournamentId: 'ts-1',
    tournamentName,
    startDate: '2026-12-05',
    endDate: '2026-12-12',
    parentOrganisation: { organisationId: 'p-1' },
  });
  const durable = (body: any, commandId = randomUUID()) => ({
    ...body,
    commandId,
    commandActor: USER.userId,
    commandFingerprint: saveFingerprint(body),
  });
  const save = (body: any) => service.saveTournamentRecords(body, USER);
  const stored = async () =>
    (await admin.query(`SELECT data->>'tournamentName' AS name, updated_at FROM ${schema}.tournaments`)).rows;
  const serverUpdatedAt = async () =>
    ((await facade.fetchTournamentUpdatedAt({ tournamentId: 'ts-1' })) as any).serverUpdatedAt;
  const count = async (table: string) =>
    Number((await admin.query(`SELECT count(*) FROM ${schema}.${table}`)).rows[0].count);

  beforeAll(async () => {
    admin = new Pool(getPostgresConfig());
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      ...getPostgresConfig(),
      options: `-c search_path=${schema}`,
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    for (const file of migrations)
      await pool.query(await readFile(join(__dirname, '../../storage/postgres/migrations', file), 'utf8'));
    await pool.query(
      `INSERT INTO providers (provider_id, organisation_abbreviation, organisation_name, data) VALUES ($1, $2, $3, '{}')`,
      ['p-1', 'P1', 'Provider One'],
    );
    process.env.PROJECTION_OUTBOX_ENABLED = 'true';
    const outbox = new PostgresProjectionOutboxStorage(pool);
    const providers = new PostgresProviderStorage(pool);
    facade = new TournamentStorageService(
      new PostgresTournamentStorage(pool),
      providers,
      new PostgresCalendarStorage(pool),
      outbox,
      new PostgresParticipationStorage(pool),
    );
    service = new FactoryService(
      facade,
      new SnapshotProjectionService(outbox),
      new MutationServicesService(outbox, { record: vi.fn(), isEnabled: false } as any, new CommandReceipts(pool)),
      { getAssignedRoles: vi.fn().mockResolvedValue(new Map()) } as any,
      {} as any,
      {} as any,
      {} as any,
      providers,
    );
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE tournaments, command_receipts, projection_queue, projection_snapshot_requests, calendar_tournaments',
    );
    delete process.env.PROJECTION_SNAPSHOT_MODE;
  });
  afterAll(async () => {
    for (const [key, value] of [
      ['PROJECTION_OUTBOX_ENABLED', previousEnv.outbox],
      ['PROJECTION_SNAPSHOT_MODE', previousEnv.mode],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  it('answers a resent durable save from its receipt and never overwrites what landed since', async () => {
    const command = durable({ tournamentRecord: record('Offline copy') });
    const first: any = await save(structuredClone(command)); // its answer is lost
    expect(first.success).toBe(true);
    expect(first.durableReceipt).toBe(true);

    await facade.saveTournamentRecord({ tournamentRecord: record('Mutated since') });
    const resent: any = await save(structuredClone(command));
    expect(resent.deduplicated).toBe(true);
    expect((await stored())[0].name).toBe('Mutated since');
  });

  it('refuses a conditional save over a record written since it was read, and saves on a current read', async () => {
    await save({ tournamentRecord: record('Original') });
    const seen = await serverUpdatedAt();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await facade.saveTournamentRecord({ tournamentRecord: record('Mutated since') });

    await expect(
      save({ tournamentRecord: record('Stale copy'), expectedServerUpdatedAt: { 'ts-1': seen } }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await stored())[0].name).toBe('Mutated since');

    const current = await serverUpdatedAt();
    const result: any = await save({
      tournamentRecord: record('Current copy'),
      expectedServerUpdatedAt: { 'ts-1': current },
    });
    expect(result.success).toBe(true);
    expect((await stored())[0].name).toBe('Current copy');
  });

  it('treats a null expectation as "must not exist yet"', async () => {
    const created: any = await save({ tournamentRecord: record('Created'), expectedServerUpdatedAt: { 'ts-1': null } });
    expect(created.success).toBe(true);
    await expect(
      save({ tournamentRecord: record('Second create'), expectedServerUpdatedAt: { 'ts-1': null } }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await stored())[0].name).toBe('Created');
  });

  it('rolls back a refused durable save and writes no receipt, so a corrected resend can apply', async () => {
    await save({ tournamentRecord: record('Original') });
    const body = {
      tournamentRecord: record('Stale copy'),
      expectedServerUpdatedAt: { 'ts-1': '2000-01-01T00:00:00.000Z' },
    };
    await expect(save(durable(body))).rejects.toMatchObject({ status: 409 });
    expect(await count('command_receipts')).toBe(0);
    expect((await stored())[0].name).toBe('Original');
  });

  it('commits the snapshot span with a durable save, on its own connection', async () => {
    const result: any = await save(durable({ tournamentRecord: record('Inline') }));
    expect(result.success).toBe(true);
    expect(await count('projection_queue')).toBeGreaterThan(0);
  });

  it('commits the deferred snapshot request with a durable save, on its own connection', async () => {
    process.env.PROJECTION_SNAPSHOT_MODE = 'deferred';
    const result: any = await save(durable({ tournamentRecord: record('Deferred') }));
    expect(result.success).toBe(true);
    expect(await count('projection_snapshot_requests')).toBe(1);
  });
});
