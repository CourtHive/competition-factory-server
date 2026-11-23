import { PostgresProjectionOutboxStorage } from 'src/storage/postgres/postgres-projection-outbox.storage';
import { resetShardShadowStats, shardShadowStats } from '../../helpers/executionQueueShadow';
import { PostgresParticipationStorage } from 'src/storage/postgres/postgres-participation.storage';
import { commandFingerprint, CommandReceipts } from 'src/storage/postgres/commandReceipts';
import { PostgresTournamentStorage } from 'src/storage/postgres/postgres-tournament.storage';
import { PostgresCalendarStorage } from 'src/storage/postgres/postgres-calendar.storage';
import { PostgresProviderStorage } from 'src/storage/postgres/postgres-provider.storage';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import * as physical from 'src/storage/postgres/physicalFootprintReader';
import { operatorScorePrecondition } from '../../../operator/scoreRequest';
import { commandTransaction } from 'src/storage/postgres/commandTransaction';
import { getPostgresConfig } from 'src/storage/postgres/postgres.config';
import { mocksEngine, tournamentEngine } from 'tods-competition-factory';
import { executionQueue } from './executionQueue';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';

// The physical record is for the private replay. The authoritative save, projection rows and receipt must agree
// with the feature-off command, including draws and participants outside the physical read.
describe.skipIf(process.env.STORAGE_LAYOUT_DB_TESTS !== 'true')('durable physical scoring shadow', () => {
  const schema = 'queue_shadow_' + randomUUID().replace(/-/g, '');
  const tournamentId = 'physical-score';
  let pool: Pool, peer: Pool;
  let storage: PostgresTournamentStorage, facade: TournamentStorageService;
  let commandReceipts: CommandReceipts, projectionOutbox: PostgresProjectionOutboxStorage;
  let template: any, matchUpId: string, drawId: string;
  let reference: Awaited<ReturnType<typeof settled>>;
  const methods = () => [
    {
      method: 'setMatchUpStatus',
      params: {
        matchUpId,
        outcome: {
          winningSide: 1,
          matchUpStatus: 'COMPLETED',
          sets: [{ setNumber: 1, side1Score: 6, side2Score: 0, winningSide: 1 }],
        },
      },
    },
  ];

  async function prepare() {
    expect((await storage.saveTournamentRecord({ tournamentRecord: template })).success).toBe(true);
    await pool.query("SELECT set_tournament_storage_layout($1, 'sharded')", [tournamentId]);
    await pool.query('TRUNCATE projection_queue, command_receipts');
    resetShardShadowStats();
  }

  async function settled() {
    const {
      rows: [parent],
    } = await peer.query('SELECT data FROM tournaments WHERE tournament_id=$1', [tournamentId]);
    const { rows } = await peer.query(
      'SELECT tournament_id, op, table_name, row_key, row_data, topic, snapshot_id FROM projection_queue ORDER BY seq',
    );
    return { record: parent.data, outbox: rows };
  }

  function command() {
    const intent = { tournamentIds: [tournamentId], methods: methods(), rollbackOnError: true };
    return {
      ...intent,
      commandId: randomUUID(),
      commandActor: 'physical-test',
      commandFingerprint: commandFingerprint(intent),
    };
  }

  const execute = (payload: ReturnType<typeof command>) =>
    executionQueue(payload, { commandReceipts, projectionOutbox }, facade);

  function configureStorage() {
    storage = new PostgresTournamentStorage(pool);
    facade = new TournamentStorageService(
      storage,
      new PostgresProviderStorage(pool),
      new PostgresCalendarStorage(pool),
      projectionOutbox,
      new PostgresParticipationStorage(pool),
    );
  }

  beforeAll(async () => {
    const config = { ...getPostgresConfig(), options: `-c search_path=${schema}` };
    peer = new Pool(config);
    await peer.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ ...config, max: 1, connectionTimeoutMillis: 2000 });
    const migrations = [
      '001-initial-schema',
      '039-add-projection-outbox',
      '042-add-tournament-owner-epoch',
      '045-add-participation-index',
      '046-participation-issuing-organisation',
      '047-add-calendar-tournaments',
      '054-command-receipts',
      '055-projection-snapshot-id-and-requests',
      '061-tournament-storage-layout',
      '062-tournament-shards',
    ];
    for (const name of migrations)
      await pool.query(
        await readFile(join(__dirname, '../../../../storage/postgres/migrations', name + '.sql'), 'utf8'),
      );
    await pool.query(
      await readFile(join(__dirname, '../../../../scripts/sharding/enable-record-sharding.sql'), 'utf8'),
    );
    vi.stubEnv('PROJECTION_OUTBOX_ENABLED', 'true');
    vi.stubEnv('SHARD_SHADOW_SAMPLE_RATE', '0');
    vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_READS', 'false');
    projectionOutbox = new PostgresProjectionOutboxStorage(pool);
    configureStorage();
    commandReceipts = new CommandReceipts(pool);
    const generated = mocksEngine.generateTournamentRecord({
      nonRandom: 4891,
      tournamentAttributes: { tournamentId },
      participantsProfile: { participantsCount: 24 },
      drawProfiles: [{ drawSize: 8 }, { drawSize: 8 }],
    });
    template = generated.tournamentRecord;
    template.parentOrganisation = { organisationId: 'p-1' };
    await pool.query(
      "INSERT INTO providers(provider_id,organisation_abbreviation,organisation_name,data) VALUES ('p-1','P1','Provider','{}')",
    );
    drawId = generated.drawIds[0];
    matchUpId = template.events
      .flatMap((e) => e.drawDefinitions)
      .find((d) => d.drawId === drawId)
      .structures[0].matchUps.find((m) => m.roundNumber === 1).matchUpId;
    tournamentEngine.outcomePipeline('v2');
    tournamentEngine.setClock('2026-11-23T12:00:00Z');
    await prepare();
    expect(await execute(command())).toMatchObject({ success: true, durableReceipt: true });
    reference = await settled();
    expect(reference.record.participants).toEqual(template.participants);
    const draws = reference.record.events.flatMap((e) => e.drawDefinitions);
    expect(draws).toHaveLength(2);
    expect(draws.find((d) => d.drawId !== drawId)).toEqual(
      template.events.flatMap((e) => e.drawDefinitions).find((d) => d.drawId !== drawId),
    );
    expect(
      draws.find((d) => d.drawId === drawId).structures[0].matchUps.find((m) => m.matchUpId === matchUpId),
    ).toMatchObject({ matchUpStatus: 'COMPLETED', winningSide: 1 });
    expect(reference.outbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table_name: 'match_ups',
          row_key: { match_up_id: matchUpId },
          row_data: expect.objectContaining({ winning_side: 1 }),
        }),
      ]),
    );
  });

  beforeEach(async () => {
    vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_READS', 'true');
    vi.stubEnv('SHARD_SHADOW_SAMPLE_RATE', '1');
    vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_TOURNAMENT_IDS', tournamentId);
    configureStorage();
    await prepare();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    tournamentEngine.setClock();
    tournamentEngine.outcomePipeline('v1');
    vi.unstubAllEnvs();
    await pool?.end();
    if (peer) {
      try {
        await peer.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await peer.end();
      }
    }
  });

  it.each(['physical', 'divergent', 'stale', 'document', 'sql-error', 'disabled', 'unlisted', 'unsampled'] as const)(
    'commits the complete feature-off record and ordered outbox with %s input',
    async (mode) => {
      if (mode === 'disabled') {
        vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_READS', 'false');
        configureStorage();
      }
      if (mode === 'unlisted') {
        vi.stubEnv('CFS_PHYSICAL_FOOTPRINT_TOURNAMENT_IDS', 'another-tournament');
        configureStorage();
      }
      const payload = command();
      const read = vi.spyOn(physical, 'readPhysicalFootprint');
      const fetch = vi.spyOn(facade, 'fetchTournamentRecords');
      const client = await pool.connect();
      const sql = vi.spyOn(client, 'query');
      client.release();

      if (mode === 'unsampled') vi.stubEnv('SHARD_SHADOW_SAMPLE_RATE', '0');
      if (mode === 'document') await pool.query("SELECT set_tournament_storage_layout($1,'document')", [tournamentId]);
      if (mode === 'divergent') {
        // Falsification: change only a physical draw at the SAME parent revision. The diagnostic must
        // see the injected difference; the client, parent, and durable projection must stay authoritative.
        await pool.query(
          "UPDATE draw_definitions SET draw = draw || jsonb_build_object('drawName', 'only-on-shadow') WHERE tournament_id=$1 AND draw_id=$2",
          [tournamentId, drawId],
        );
      }
      if (mode === 'stale') {
        // A new parent tuple committed by another connection, with identical contents AND updated_at.
        Object.assign(payload, {
          [operatorScorePrecondition]: async () => {
            await peer.query('UPDATE tournaments SET updated_at=updated_at WHERE tournament_id=$1', [tournamentId]);
          },
        });
      }
      if (mode === 'sql-error')
        read.mockImplementationOnce(async () => {
          await commandTransaction.getStore()!.client.query('SELECT 1/0');
          throw Error('expected PostgreSQL to raise division_by_zero');
        });

      const ack = await execute(payload);
      expect(ack).toMatchObject({ success: true, durableReceipt: true, commandId: payload.commandId });
      const physicalAttempt = !['disabled', 'unlisted', 'unsampled'].includes(mode);
      expect(fetch).toHaveBeenCalledWith(
        physicalAttempt ? { tournamentIds: [tournamentId], captureRevision: true } : { tournamentIds: [tournamentId] },
      );
      expect(read).toHaveBeenCalledTimes(physicalAttempt ? 1 : 0);
      const commands = sql.mock.calls.map(([statement]) => String(statement));
      expect(commands.includes('SAVEPOINT physical_shard_shadow')).toBe(physicalAttempt);
      expect(commands.includes('ROLLBACK TO SAVEPOINT physical_shard_shadow')).toBe(mode === 'sql-error');
      expect(commands.includes('RELEASE SAVEPOINT physical_shard_shadow')).toBe(physicalAttempt);
      await vi.waitFor(() =>
        expect(shardShadowStats()).toMatchObject({
          pending: 0,
          physicalSelected: Number(mode === 'physical' || mode === 'divergent'),
          physicalFallback: Number(mode === 'document'),
          physicalReadError: Number(mode === 'sql-error'),
          physicalStale: Number(mode === 'stale'),
          physicalOutcomes: {
            match: Number(mode === 'physical'),
            mismatch: Number(mode === 'divergent'),
            refused: 0,
            error: 0,
          },
          match: Number(mode !== 'unsampled' && mode !== 'divergent'),
          mismatch: Number(mode === 'divergent'),
          refused: 0,
          error: 0,
        }),
      );
      expect(await settled()).toEqual(reference);
      const receipt = await peer.query('SELECT result FROM command_receipts WHERE command_id=$1', [payload.commandId]);
      expect(receipt.rows[0]?.result).toMatchObject({ success: true, durableReceipt: true });
      expect(await execute(payload)).toMatchObject({ success: true, deduplicated: true });
      expect(await settled()).toEqual(reference);
      expect(read).toHaveBeenCalledTimes(physicalAttempt ? 1 : 0);
    },
  );
  it('keeps the original shadow for a non-durable score even when the physical reader is enabled', async () => {
    const read = vi.spyOn(physical, 'readPhysicalFootprint');
    const fetch = vi.spyOn(facade, 'fetchTournamentRecords');
    const result = await executionQueue(
      { tournamentIds: [tournamentId], methods: methods() },
      { projectionOutbox },
      facade,
    );
    expect(result.success).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith({ tournamentIds: [tournamentId] });
    await vi.waitFor(() =>
      expect(shardShadowStats()).toMatchObject({
        pending: 0,
        match: 1,
        physicalSelected: 0,
        physicalOutcomes: { match: 0 },
      }),
    );
    expect(await settled()).toEqual(reference);
  });
  it('discards the shadow, record write and outbox when the final durable receipt insert fails', async () => {
    const payload = command();
    const before = await settled();
    expect(before.outbox).toHaveLength(0);
    const save = vi.spyOn(facade, 'saveTournamentRecords');
    const enqueue = vi.spyOn(projectionOutbox, 'enqueue');
    await pool.query("ALTER TABLE command_receipts ADD CONSTRAINT refuse_test_actor CHECK (actor <> 'physical-test')");
    try {
      await expect(execute(payload)).rejects.toThrow('Durable command outcome uncertain');
      expect(save).toHaveBeenCalledOnce();
      expect(enqueue).toHaveBeenCalledOnce();
      expect(await settled()).toEqual(before);
      expect((await peer.query('SELECT * FROM command_receipts')).rowCount).toBe(0);
      expect(shardShadowStats()).toMatchObject({
        physicalSelected: 1,
        pending: 0,
        match: 0,
        physicalOutcomes: { match: 0, refused: 0, mismatch: 0, error: 0 },
      });
    } finally {
      await pool.query('ALTER TABLE command_receipts DROP CONSTRAINT refuse_test_actor');
    }
  });
});
