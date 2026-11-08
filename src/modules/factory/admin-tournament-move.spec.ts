import { PostgresTournamentProvisionerStorage } from 'src/storage/postgres/postgres-tournament-provisioner.storage';
import { PostgresProvisionerProviderStorage } from 'src/storage/postgres/postgres-provisioner-provider.storage';
import { PostgresProjectionOutboxStorage } from 'src/storage/postgres/postgres-projection-outbox.storage';
import { PostgresParticipationStorage } from 'src/storage/postgres/postgres-participation.storage';
import { PostgresTournamentStorage } from 'src/storage/postgres/postgres-tournament.storage';
import { PostgresAssignmentStorage } from 'src/storage/postgres/postgres-assignment.storage';
import { MutationServicesService } from '../mutation-services/mutation-services.service';
import { PostgresCalendarStorage } from 'src/storage/postgres/postgres-calendar.storage';
import { PostgresProviderStorage } from 'src/storage/postgres/postgres-provider.storage';
import { SnapshotProjectionService } from './projection/snapshot-projection.service';
import { PostgresAuditStorage } from 'src/storage/postgres/postgres-audit.storage';
import { PostgresGrantStorage } from 'src/storage/postgres/postgres-grant.storage';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { AdminTournamentMoveController } from './admin-tournament-move.controller';
import { getPostgresConfig } from 'src/storage/postgres/postgres.config';
import { CommandReceipts } from 'src/storage/postgres/commandReceipts';
import { Roles } from '../account/auth/decorators/roles.decorator';
import { RolesGuard } from '../account/auth/guards/role.guard';
import { SUPER_ADMIN } from 'src/common/constants/roles';
import { AuditService } from '../audit/audit.service';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { join } from 'node:path';
import { Pool } from 'pg';
import {
  AdminTournamentMoveService,
  MOVE_REASON,
  PROVIDER_MOVES_EXTENSION,
  type MoveProviderRequest,
} from './admin-tournament-move.service';

// The super-admin provider move (Mentat planning/SUPERADMIN_TOURNAMENT_PROVIDER_MOVE.md) against REAL Postgres, in its
// own schema: every binding a hand-written move had to remember is asserted here, because the first hand move updated
// the columns and left `calendar_tournaments.identity` naming the old provider — a miss only the stored rows reveal.
// Cherry-picked like factory.save-durable.spec.ts: the migration runner cannot target a scratch schema (see 004 below).
const MIGRATIONS = [
  '001-initial-schema.sql',
  '007-add-tournament-assignments.sql',
  '008-add-audit-log.sql',
  '009-add-provisioner-tables.sql',
  '036-add-audit-actor.sql',
  '039-add-projection-outbox.sql',
  '042-add-tournament-owner-epoch.sql',
  '044-add-tournament-grants.sql',
  '045-add-participation-index.sql',
  '046-participation-issuing-organisation.sql',
  '047-add-calendar-tournaments.sql',
  '054-command-receipts.sql',
  '055-projection-snapshot-id-and-requests.sql',
  '061-tournament-storage-layout.sql',
];

describe('AdminTournamentMoveService — move a tournament between providers', () => {
  const schema = `provider_move_${randomUUID().replace(/-/g, '')}`;
  const T = 'move-t-1';
  const FROM = 'p-from';
  const TO = 'p-to';
  const OTHER = 'p-other';
  const PROV_A = randomUUID();
  const PROV_B = randomUUID();
  const ADMIN_ID = randomUUID();
  const DIRECTOR_ID = randomUUID();
  const SUPER: any = {
    userId: ADMIN_ID,
    email: 'sa@test.com',
    isSuperAdmin: true,
    providerIds: [],
    roles: [SUPER_ADMIN],
  };

  let admin: Pool;
  let pool: Pool;
  let facade: TournamentStorageService;
  let auditService: AuditService;
  let service: AdminTournamentMoveService;
  const broadcast = { broadcastTournamentReplaced: vi.fn() };
  const previousOutbox = process.env.PROJECTION_OUTBOX_ENABLED;

  const q = async (sql: string, params: any[] = []): Promise<any[]> =>
    (await admin.query(sql.split('$S').join(schema), params)).rows;
  const record = (extra: any = {}) => ({
    tournamentId: T,
    tournamentName: 'Aruba Open',
    startDate: '2026-11-08',
    endDate: '2026-11-15',
    parentOrganisation: {
      organisationId: FROM,
      organisationName: 'From Club',
      organisationAbbreviation: 'FROM',
      onlineResources: [{ name: 'providerImage', identifier: 'https://x/from.png', resourceType: 'URL' }],
      providerConfigCaps: { kept: true },
      extensions: [{ name: 'provisionerOrigin', value: { provisionerId: PROV_A, provisionerName: 'Prov A' } }],
    },
    ...extra,
  });
  const move = (overrides: Partial<MoveProviderRequest> = {}) =>
    service.moveProvider(
      {
        tournamentId: T,
        fromProviderId: FROM,
        toProviderId: TO,
        reason: 'wrong provider',
        commandId: randomUUID(),
        ...overrides,
      },
      SUPER,
    );
  const bindings = async () => ({
    column: (await q(`SELECT provider_id FROM $S.tournaments WHERE tournament_id = $1`, [T]))[0]?.provider_id,
    data: (
      await q(
        `SELECT data->'parentOrganisation' AS po, data->'extensions' AS ext FROM $S.tournaments WHERE tournament_id = $1`,
        [T],
      )
    )[0],
    calendar: (
      await q(
        `SELECT provider_id, provider_abbr, identity->'parentOrganisation'->>'organisationId' AS identity_id FROM $S.calendar_tournaments WHERE tournament_id = $1`,
        [T],
      )
    )[0],
    mapping: (
      await q(`SELECT provisioner_id, provider_id FROM $S.tournament_provisioner WHERE tournament_id = $1`, [T])
    )[0],
  });

  beforeAll(async () => {
    admin = new Pool(getPostgresConfig());
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      ...getPostgresConfig(),
      options: `-c search_path=${schema}`,
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    for (const file of MIGRATIONS) {
      await pool.query(await readFile(join(__dirname, '../../storage/postgres/migrations', file), 'utf8'));
      // 004 moves users' primary key to `user_id`, but its DO blocks look `users_pkey` up in information_schema
      // without a schema, find PUBLIC's, and skip this schema. This is exactly what 004 does, applied here.
      if (file === '001-initial-schema.sql')
        await pool.query(`ALTER TABLE users ADD COLUMN user_id UUID NOT NULL DEFAULT gen_random_uuid();
          ALTER TABLE users DROP CONSTRAINT users_pkey; ALTER TABLE users ADD PRIMARY KEY (user_id)`);
    }
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
    auditService = new AuditService(new PostgresAuditStorage(pool));
    service = new AdminTournamentMoveService(
      facade,
      new SnapshotProjectionService(outbox),
      new MutationServicesService(outbox, { record: vi.fn(), isEnabled: false } as any, new CommandReceipts(pool)),
      auditService,
      broadcast as any,
      providers,
      new PostgresProvisionerProviderStorage(pool),
      new PostgresTournamentProvisionerStorage(pool),
      new PostgresAssignmentStorage(pool),
      new PostgresGrantStorage(pool),
    );
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    broadcast.broadcastTournamentReplaced.mockReset();
    await pool.query(
      `TRUNCATE tournaments, calendar_tournaments, command_receipts, projection_queue, projection_snapshot_requests,
        audit_log, tournament_assignments, tournament_grants, tournament_provisioner, provisioner_providers,
        provisioners, providers, users CASCADE`,
    );
    for (const [id, abbr, name, data] of [
      [FROM, 'FROM', 'From Club', {}],
      [TO, 'TO', 'To Club', { onlineResources: [{ name: 'providerImage', identifier: 'https://x/to.png' }] }],
      [OTHER, 'OTHER', 'Other Club', {}],
    ])
      await pool.query(
        `INSERT INTO providers (provider_id, organisation_abbreviation, organisation_name, data) VALUES ($1, $2, $3, $4)`,
        [id, abbr, name, JSON.stringify(data)],
      );
    for (const [id, name] of [
      [PROV_A, 'Prov A'],
      [PROV_B, 'Prov B'],
    ])
      await pool.query(`INSERT INTO provisioners (provisioner_id, name) VALUES ($1, $2)`, [id, name]);
    for (const [id, email] of [
      [ADMIN_ID, 'sa@test.com'],
      [DIRECTOR_ID, 'director@test.com'],
    ])
      await pool.query(`INSERT INTO users (user_id, email, password) VALUES ($1, $2, 'x')`, [id, email]);
    // Same provisioner owns FROM and TO unless a test says otherwise.
    await pool.query(
      `INSERT INTO provisioner_providers (provisioner_id, provider_id, relationship) VALUES ($1, $2, 'owner'), ($1, $3, 'owner')`,
      [PROV_A, FROM, TO],
    );
    await facade.saveTournamentRecord({ tournamentRecord: record() });
    await pool.query(
      `INSERT INTO tournament_provisioner (tournament_id, provisioner_id, provider_id) VALUES ($1, $2, $3)`,
      [T, PROV_A, FROM],
    );
  });

  afterAll(async () => {
    if (previousOutbox === undefined) delete process.env.PROJECTION_OUTBOX_ENABLED;
    else process.env.PROJECTION_OUTBOX_ENABLED = previousOutbox;
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  it('moves every binding together and keeps what is not provider identity', async () => {
    const before = await bindings();
    expect(before.column).toBe(FROM);
    expect(before.calendar).toMatchObject({ provider_id: FROM, provider_abbr: 'FROM', identity_id: FROM });

    const result: any = await move();
    expect(result.success).toBe(true);
    expect(result.deltas).toBeGreaterThan(0);

    const after = await bindings();
    expect(after.column).toBe(TO);
    expect(after.data.po).toMatchObject({
      organisationId: TO,
      organisationName: 'To Club',
      organisationAbbreviation: 'TO',
      onlineResources: [{ name: 'providerImage', identifier: 'https://x/to.png' }],
      providerConfigCaps: { kept: true },
    });
    // provisionerOrigin is history (D3): kept on a move.
    expect(after.data.po.extensions).toEqual([expect.objectContaining({ name: 'provisionerOrigin' })]);
    expect(after.calendar).toEqual({ provider_id: TO, provider_abbr: 'TO', identity_id: TO });
    // Same provisioner: the mapping follows the provider and keeps its provisioner.
    expect(after.mapping).toEqual({ provisioner_id: PROV_A, provider_id: TO });

    const moves = after.data.ext.find((e: any) => e.name === PROVIDER_MOVES_EXTENSION).value;
    expect(moves).toEqual([
      expect.objectContaining({ fromProviderId: FROM, toProviderId: TO, movedBy: ADMIN_ID, reason: 'wrong provider' }),
    ]);

    const audit = await q(`SELECT action_type, metadata FROM $S.audit_log WHERE tournament_id = $1`, [T]);
    expect(audit).toEqual([
      expect.objectContaining({
        action_type: 'MOVE_TOURNAMENT_PROVIDER',
        metadata: expect.objectContaining({ reason: 'wrong provider' }),
      }),
    ]);
    // The read model learns of the move only through the snapshot, and it must say TO.
    const queued = await q(`SELECT count(*)::int AS n FROM $S.projection_queue WHERE row_data->>'provider_id' = $1`, [
      TO,
    ]);
    expect(queued[0].n).toBeGreaterThan(0);

    expect(broadcast.broadcastTournamentReplaced).toHaveBeenCalledTimes(1);
    expect(broadcast.broadcastTournamentReplaced).toHaveBeenCalledWith(T, {
      reason: MOVE_REASON,
      serverUpdatedAt: result.serverUpdatedAt,
    });
  });

  it('a dry run returns the plan and writes nothing', async () => {
    const result: any = await move({ dryRun: true, reason: undefined, commandId: undefined });
    expect(result).toMatchObject({ success: true, dryRun: true });
    expect(result.plan).toMatchObject({
      from: { providerId: FROM, organisationAbbreviation: 'FROM' },
      to: { providerId: TO, organisationAbbreviation: 'TO' },
      provisioner: { crossProvisioner: false, after: { provisionerId: PROV_A, providerId: TO } },
      blockers: [],
    });
    expect((await bindings()).column).toBe(FROM);
    expect(await q(`SELECT * FROM $S.audit_log`)).toEqual([]);
    expect(broadcast.broadcastTournamentReplaced).not.toHaveBeenCalled();
  });

  it('a resend of the same command answers from its receipt; a new command is refused once it has moved', async () => {
    const commandId = randomUUID();
    const first: any = await move({ commandId });
    const resent: any = await move({ commandId });
    expect(resent).toMatchObject({ success: true, deduplicated: true });
    expect(resent.serverUpdatedAt).toBe(first.serverUpdatedAt);
    expect(await q(`SELECT * FROM $S.audit_log`)).toHaveLength(1);

    const again: any = await move();
    expect(again).toMatchObject({ error: 'FROM_PROVIDER_MISMATCH', currentProviderId: TO });
  });

  it('refuses while the old provider has access rows, and revokes only those when asked (D2)', async () => {
    await pool.query(
      `INSERT INTO tournament_assignments (tournament_id, user_id, provider_id, granted_by) VALUES ($1, $2, $3, $4)`,
      [T, DIRECTOR_ID, FROM, ADMIN_ID],
    );
    await pool.query(
      `INSERT INTO tournament_grants (tournament_id, user_id, provider_id, capability) VALUES ($1, $2, $3, 'score'), ($1, $2, $4, 'score')`,
      [T, DIRECTOR_ID, FROM, OTHER],
    );

    const blocked: any = await move();
    expect(blocked).toMatchObject({ error: 'MOVE_BLOCKED', blockers: ['ACCESS_ROWS_PRESENT'] });
    expect(blocked.plan.accessRows.assignments).toEqual([
      { userId: DIRECTOR_ID, email: 'director@test.com', assignmentRole: 'DIRECTOR' },
    ]);
    expect(blocked.plan.accessRows.grants).toHaveLength(1);
    expect((await bindings()).column).toBe(FROM);

    const moved: any = await move({ revokeAccess: true });
    expect(moved.success).toBe(true);
    expect(await q(`SELECT * FROM $S.tournament_assignments`)).toEqual([]);
    // The grant another provider made is not the move's business.
    expect(await q(`SELECT provider_id FROM $S.tournament_grants`)).toEqual([{ provider_id: OTHER }]);
  });

  it('refuses a cross-provisioner move until confirmed, then hands the mapping to the destination owner (D3)', async () => {
    await pool.query(`DELETE FROM provisioner_providers WHERE provider_id = $1`, [TO]);
    await pool.query(
      `INSERT INTO provisioner_providers (provisioner_id, provider_id, relationship) VALUES ($1, $2, 'owner')`,
      [PROV_B, TO],
    );

    expect(await move()).toMatchObject({ error: 'MOVE_BLOCKED', blockers: ['CROSS_PROVISIONER_UNCONFIRMED'] });

    const moved: any = await move({ crossProvisioner: true });
    expect(moved.success).toBe(true);
    const after = await bindings();
    expect(after.mapping).toEqual({ provisioner_id: PROV_B, provider_id: TO });
    // Where it came from is not lost: the origin stamp stays.
    expect(after.data.po.extensions[0].value.provisionerId).toBe(PROV_A);
  });

  it('takes an unlisted record off the old provider calendar', async () => {
    await facade.saveTournamentRecord({
      tournamentRecord: record({ extensions: [{ name: 'calendarListed', value: false }] }),
    });
    // The unlisted save leaves the earlier row in place — the situation the move must not inherit.
    expect((await bindings()).calendar?.provider_id).toBe(FROM);

    expect(((await move()) as any).success).toBe(true);
    expect((await bindings()).calendar).toBeUndefined();
  });

  it('rolls everything back, and tells no client, when the audit row cannot be written', async () => {
    await pool.query(
      `INSERT INTO tournament_assignments (tournament_id, user_id, provider_id, granted_by) VALUES ($1, $2, $3, $4)`,
      [T, DIRECTOR_ID, FROM, ADMIN_ID],
    );
    vi.spyOn(auditService, 'recordProviderMove').mockRejectedValueOnce(new Error('audit down'));

    await expect(move({ revokeAccess: true })).rejects.toThrow('audit down');

    const after = await bindings();
    expect(after.column).toBe(FROM);
    expect(after.calendar.provider_id).toBe(FROM);
    expect(after.mapping).toEqual({ provisioner_id: PROV_A, provider_id: FROM });
    expect(await q(`SELECT * FROM $S.tournament_assignments`)).toHaveLength(1);
    expect(await q(`SELECT * FROM $S.projection_queue WHERE row_data->>'provider_id' = $1`, [TO])).toEqual([]);
    expect(broadcast.broadcastTournamentReplaced).not.toHaveBeenCalled();
  });

  it.each([
    [{ fromProviderId: OTHER }, 'FROM_PROVIDER_MISMATCH'],
    [{ toProviderId: FROM }, 'SAME_PROVIDER'],
    [{ toProviderId: 'p-missing' }, 'DESTINATION_NOT_FOUND'],
    [{ tournamentId: 'missing' }, 'TOURNAMENT_NOT_FOUND'],
    [{ reason: '   ' }, 'REASON_REQUIRED'],
    [{ commandId: undefined }, 'COMMAND_ID_REQUIRED'],
  ])('refuses %o with %s and writes nothing', async (overrides, error) => {
    expect(await move(overrides as any)).toMatchObject({ error });
    expect((await bindings()).column).toBe(FROM);
    expect(await q(`SELECT * FROM $S.audit_log`)).toEqual([]);
  });

  it('refuses a caller that is not a super-admin even when called directly', async () => {
    const result = await service.moveProvider(
      { tournamentId: T, fromProviderId: FROM, toProviderId: TO, reason: 'x', commandId: randomUUID() },
      { ...SUPER, isSuperAdmin: false },
    );
    expect(result).toMatchObject({ error: 'SUPER_ADMIN_REQUIRED' });
  });

  it('the route is guarded: RolesGuard applied, SUPER_ADMIN required', () => {
    // `@Roles` alone is inert without the guard (a past CFS bug), so assert both.
    const guards = Reflect.getMetadata('__guards__', AdminTournamentMoveController);
    expect(guards).toContain(RolesGuard);
    expect(new Reflector().get(Roles, AdminTournamentMoveController)).toEqual([SUPER_ADMIN]);
    expect(new Reflector().get(Roles, AdminTournamentMoveController.prototype.moveProvider)).toEqual([SUPER_ADMIN]);
  });
});
