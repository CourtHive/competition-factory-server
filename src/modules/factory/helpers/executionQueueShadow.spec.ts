import { installFootprintStandIn, removeFootprintTools } from 'src/tests/helpers/footprintStandIn';
import { mocksEngine, tournamentEngine } from 'tods-competition-factory';

import {
  captureShardShadow,
  planShardShadow,
  resetShardShadowStats,
  runShardShadow,
  scheduleShardShadow,
  shardShadowStats,
} from './executionQueueShadow';

/**
 * The shard shadow check, against the real engine. The footprint tools are the factory's when the installed factory
 * has them, a stand-in with the same contract otherwise (src/tests/helpers/footprintStandIn.ts).
 */
const scoreFirstMatchUp = () => {
  const {
    tournamentRecord,
    drawIds: [drawId],
  } = mocksEngine.generateTournamentRecord({ drawProfiles: [{ drawSize: 8 }, { drawSize: 4 }] });
  tournamentEngine.setState(tournamentRecord);
  const matchUp: any = tournamentEngine
    .allTournamentMatchUps({ inContext: true })
    .matchUps?.find((m: any) => m.drawId === drawId && m.roundNumber === 1);
  const methods = [
    {
      method: 'setMatchUpStatus',
      params: {
        drawId,
        matchUpId: matchUp.matchUpId,
        outcome: {
          winningSide: 1,
          matchUpStatus: 'COMPLETED',
          sets: [{ setNumber: 1, side1Score: 6, side2Score: 0, winningSide: 1 }],
        },
      },
    },
  ];
  return { tournamentRecord, tournamentId: tournamentRecord.tournamentId, drawId, methods };
};

describe('shard shadow', () => {
  const ORIGINAL = { ...process.env };
  let uninstall: () => void;

  beforeEach(() => {
    resetShardShadowStats();
    process.env.SHARD_SHADOW_SAMPLE_RATE = '1';
    uninstall = installFootprintStandIn();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    uninstall();
  });

  it('is off unless sampled, and inert without the factory footprint tools', () => {
    const { tournamentRecord, tournamentId, methods } = scoreFirstMatchUp();
    const args = { methods, tournamentIds: [tournamentId], tournamentRecords: { [tournamentId]: tournamentRecord } };

    delete process.env.SHARD_SHADOW_SAMPLE_RATE;
    expect(planShardShadow(args)).toBeUndefined();

    process.env.SHARD_SHADOW_SAMPLE_RATE = '0.5';
    expect(planShardShadow({ ...args, random: () => 0.7 })).toBeUndefined();
    expect(planShardShadow({ ...args, random: () => 0.2 })).toBeDefined();

    const restore = removeFootprintTools();
    expect(planShardShadow({ ...args, random: () => 0 })).toBeUndefined();
    restore();
  });

  it('skips a queue whose footprint needs the whole record, and multi-tournament queues', () => {
    const { tournamentRecord, tournamentId } = scoreFirstMatchUp();
    const tournamentRecords = { [tournamentId]: tournamentRecord };
    const wide = [{ method: 'addEvent', params: { event: { eventName: 'x' } } }];
    expect(planShardShadow({ methods: wide, tournamentIds: [tournamentId], tournamentRecords })).toBeUndefined();
    expect(shardShadowStats().wholeRecord).toBe(1);
    const { methods } = scoreFirstMatchUp();
    expect(planShardShadow({ methods, tournamentIds: [tournamentId, 'other'], tournamentRecords })).toBeUndefined();
  });

  it('a draw-bounded score entry gives the same draw on the partial record: match', async () => {
    const { tournamentRecord, tournamentId, drawId, methods } = scoreFirstMatchUp();
    const plan = planShardShadow({
      methods,
      tournamentIds: [tournamentId],
      tournamentRecords: { [tournamentId]: tournamentRecord },
      outcomePipeline: 'v2',
    });
    expect(plan?.partialRecord.participants).toEqual([]);
    expect(plan?.partialRecord.events.flatMap((e: any) => e.drawDefinitions).map((d: any) => d.drawId)).toEqual([
      drawId,
    ]);

    // the mutation itself, on the whole record, as executionQueue runs it
    tournamentEngine.setState(tournamentRecord);
    let result: any = tournamentEngine.executionQueue(methods);
    expect(result.success).toBe(true);
    result = tournamentEngine.getTournament();
    const batch = captureShardShadow(plan, { [tournamentId]: result.tournamentRecord });
    expect(Object.keys(batch?.savedDraws ?? {})).toEqual([drawId]);

    expect(await runShardShadow(batch!)).toBe('match');
  });

  it('reports a mismatch when the partial run does not reproduce the saved draw', async () => {
    const { tournamentRecord, tournamentId, drawId, methods } = scoreFirstMatchUp();
    const plan = planShardShadow({
      methods,
      tournamentIds: [tournamentId],
      tournamentRecords: { [tournamentId]: tournamentRecord },
    });
    // the "saved" draw is the draw as it was BEFORE the score: the partial run's draw cannot equal it
    const unscored = structuredClone(tournamentRecord);
    const batch = captureShardShadow(plan, { [tournamentId]: unscored });
    expect(batch?.savedDraws[drawId]).toBeDefined();
    expect(await runShardShadow(batch!)).toBe('mismatch');
  });

  it('reports a refusal when the partial run fails', async () => {
    const { tournamentRecord, tournamentId, methods } = scoreFirstMatchUp();
    const broken = [{ ...methods[0], params: { ...methods[0].params, matchUpId: 'no-such-matchUp' } }];
    const plan = planShardShadow({
      methods: broken,
      tournamentIds: [tournamentId],
      tournamentRecords: { [tournamentId]: tournamentRecord },
    });
    const batch = captureShardShadow(plan, { [tournamentId]: tournamentRecord });
    expect(await runShardShadow(batch!)).toBe('refused');
  });

  it('schedules off the caller, counts the outcome, and never throws', async () => {
    const { tournamentRecord, tournamentId, methods } = scoreFirstMatchUp();
    const plan = planShardShadow({
      methods,
      tournamentIds: [tournamentId],
      tournamentRecords: { [tournamentId]: tournamentRecord },
    });
    tournamentEngine.setState(tournamentRecord);
    tournamentEngine.executionQueue(methods);
    const batch = captureShardShadow(plan, { [tournamentId]: tournamentEngine.getTournament().tournamentRecord });

    scheduleShardShadow(batch);
    expect(shardShadowStats().pending).toBe(1);
    await vi.waitFor(() => expect(shardShadowStats().pending).toBe(0));
    expect(shardShadowStats()).toMatchObject({ sampled: 1, match: 1, mismatch: 0 });
    scheduleShardShadow(undefined);
    expect(shardShadowStats().pending).toBe(0);
  });
});
