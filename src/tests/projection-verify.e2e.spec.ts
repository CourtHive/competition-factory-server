import { mocksEngine, tournamentEngineAsync } from 'tods-competition-factory';
import { Pool } from 'pg';

import { generateTournamentRecord } from 'src/services/fileSystem/generateTournamentRecord';
import { removeTournamentRecords } from 'src/services/fileSystem/removeTournamentRecords';
import { executionQueue } from 'src/modules/factory/functions/private/executionQueue';
import { buildProjectionDeltas } from 'src/modules/factory/projection/buildProjectionDeltas';
import { createDeltaBuffer } from 'src/modules/factory/projection/deltaBuffer';
import { PostgresProjectionOutboxStorage } from 'src/storage/postgres/postgres-projection-outbox.storage';
import fileStorage from 'src/services/fileSystem';
import { testTournamentId } from 'src/common/constants/test';

// Opt-in verification (Increment 2): proves against a REAL local Postgres that
//   1. the flatten (tournamentEngineAsync.allDrawMatchUps) returns hydrated matchUps,
//   2. buildProjectionDeltas produces match_ups + competitor rows,
//   3. PostgresProjectionOutboxStorage.enqueue lands them in projection_queue,
//   4. the full executionQueue path enqueues on commit and NOT on rollback.
// Skipped unless PROJECTION_OUTBOX_ENABLED=true (needs a local courthive DB).
// Run manually:  PROJECTION_OUTBOX_ENABLED=true PGGSSENCMODE=disable \
//   pnpm test -- --testPathPattern projection-verify

const RUN = process.env.PROJECTION_OUTBOX_ENABLED === 'true';
const d = RUN ? describe : describe.skip;

d('projection-verify (real DB)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER || 'charlesallen',
      password: process.env.PG_PASSWORD || '',
      database: process.env.PG_DATABASE || 'courthive',
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projection_queue (
        seq BIGSERIAL PRIMARY KEY, tournament_id TEXT NOT NULL, op TEXT NOT NULL,
        table_name TEXT NOT NULL, row_key JSONB NOT NULL, row_data JSONB, topic TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('DELETE FROM projection_queue');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('flattens a generated draw and enqueues match_up + competitor deltas', async () => {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      drawProfiles: [{ drawSize: 8 }],
      completeAllMatchUps: true,
      participantsProfile: { idPrefix: 'pid' },
    });
    const tournamentId = tournamentRecord.tournamentId;
    const drawId = tournamentRecord.events[0].drawDefinitions[0].drawId;

    const flattenDraw = async (_t: string, dId: string) => {
      await tournamentEngineAsync.setState(tournamentRecord);
      const res: any = await tournamentEngineAsync.allDrawMatchUps({ drawId: dId, inContext: true });
      return res?.matchUps ?? [];
    };

    // (1) the flatten assumption
    const flatMatchUps: any[] = await flattenDraw(tournamentId, drawId);
    expect(Array.isArray(flatMatchUps)).toBe(true);
    expect(flatMatchUps.length).toBeGreaterThan(0);
    const withSides = flatMatchUps.find((m: any) => m.sides?.some((s: any) => s.participant?.participantId));
    expect(withSides).toBeDefined();

    // (2) deltas from a flattenDraw intent
    const buffer = createDeltaBuffer([tournamentId]);
    buffer.intents.push({ kind: 'flattenDraw', tournamentId, drawId }, { kind: 'touchTournament', tournamentId });
    const deltas = await buildProjectionDeltas({
      intents: buffer.intents,
      tournamentRecords: { [tournamentId]: tournamentRecord },
      flattenDraw,
    });
    expect(deltas.some((x) => x.table === 'match_ups')).toBe(true);
    expect(deltas.some((x) => x.table === 'match_up_competitors')).toBe(true);
    expect(deltas.some((x) => x.table === 'tournaments')).toBe(true);

    // (3) real enqueue + read back
    process.env.PROJECTION_OUTBOX_ENABLED = 'true';
    const storage = new PostgresProjectionOutboxStorage(pool);
    expect(storage.isEnabled).toBe(true);
    await storage.enqueue(deltas);

    const rows = await pool.query('SELECT op, table_name, row_key, row_data FROM projection_queue ORDER BY seq');
    expect(rows.rows.length).toBe(deltas.length);
    const matchUpRow = rows.rows.find((r: any) => r.table_name === 'match_ups');
    expect(matchUpRow.op).toBe('upsert');
    expect(matchUpRow.row_data.tournament_id).toBe(tournamentId);
    const competitorRow = rows.rows.find((r: any) => r.table_name === 'match_up_competitors');
    expect(competitorRow.row_data.side_number).toBeGreaterThanOrEqual(1);

     
    console.log(
      `[verify] flatten produced ${flatMatchUps.length} matchUps → ${deltas.length} deltas ` +
        `(${rows.rows.filter((r: any) => r.table_name === 'match_ups').length} match_ups, ` +
        `${rows.rows.filter((r: any) => r.table_name === 'match_up_competitors').length} competitors) landed in projection_queue`,
    );
  });

  it('drives the FULL executionQueue path: committed mutation enqueues, rolled-back does not', async () => {
    process.env.PROJECTION_OUTBOX_ENABLED = 'true';
    const tournamentId = testTournamentId(__filename);
    const storage: any = {
      fetchTournamentRecords: (params: any) => fileStorage.fetchTournamentRecords(params),
      saveTournamentRecords: (params: any) => fileStorage.saveTournamentRecords(params),
      modifyProviderCalendar: () => Promise.resolve({ success: true }),
    };
    const services = { projectionOutbox: new PostgresProjectionOutboxStorage(pool) };

    await removeTournamentRecords({ tournamentId });
    const gen: any = await generateTournamentRecord(
      { tournamentAttributes: { tournamentId }, drawProfiles: [{ drawSize: 8 }] },
      { providerId: 'test-provider', roles: ['superadmin'] },
    );
    expect(gen.success).toBe(true);
    await pool.query('DELETE FROM projection_queue WHERE tournament_id = $1', [tournamentId]);

    // committed: a tournament-detail mutation fires MODIFY_TOURNAMENT_DETAIL →
    // touchTournament → a tournaments upsert lands in the outbox.
    const ok: any = await executionQueue(
      { tournamentIds: [tournamentId], methods: [{ method: 'setTournamentDates', params: { tournamentId, startDate: '2026-05-01', endDate: '2026-05-03' } }] },
      services,
      storage,
    );
    expect(ok.success).toBe(true);
    const afterCommit = await pool.query('SELECT table_name, op, row_data FROM projection_queue WHERE tournament_id = $1', [tournamentId]);
    expect(afterCommit.rows.some((r: any) => r.table_name === 'tournaments' && r.op === 'upsert')).toBe(true);
    const committedCount = afterCommit.rows.length;

    // rolled-back: a failing method with rollbackOnError → innerResult.success
    // false → NOTHING enqueues (read model can't get ahead).
    const bad: any = await executionQueue(
      { tournamentIds: [tournamentId], rollbackOnError: true, methods: [{ method: 'setMatchUpStatus', params: { matchUpId: 'no-such-matchup', outcome: { winningSide: 1 } } }] },
      services,
      storage,
    );
    expect(bad.success).toBeFalsy();
    const afterRollback = await pool.query('SELECT count(*)::int AS n FROM projection_queue WHERE tournament_id = $1', [tournamentId]);
    expect(afterRollback.rows[0].n).toBe(committedCount); // no new rows

    await removeTournamentRecords({ tournamentId });
     
    console.log(`[verify] executionQueue committed → ${committedCount} outbox row(s); rolled-back → 0 new rows`);
  });
});
