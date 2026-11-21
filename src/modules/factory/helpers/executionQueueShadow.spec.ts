import { loadFetchedRecords } from './loadFetchedRecords';
import { Logger } from '@nestjs/common';
import asyncGlobalState from '../engines/asyncGlobalState';
import { asyncEngine, mocksEngine, tournamentEngine } from 'tods-competition-factory';

import {
  captureShardShadow,
  planShardShadow,
  resetShardShadowStats,
  runShardShadow,
  scheduleShardShadow,
  shardShadowStats,
} from './executionQueueShadow';

/**
 * The shard shadow check, against the real engine and the factory's own footprint tools.
 */
const scoreFirstMatchUp = () => {
  const {
    tournamentRecord,
    drawIds: [drawId],
  } = mocksEngine.generateTournamentRecord({
    // more participants than the scored draw holds, so "the draw's participants" and "every participant" differ
    participantsProfile: { participantsCount: 16 },
    drawProfiles: [{ drawSize: 8 }, { drawSize: 4 }],
  });
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

  beforeEach(() => {
    resetShardShadowStats();
    process.env.SHARD_SHADOW_SAMPLE_RATE = '1';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('is off unless sampled', () => {
    const { tournamentRecord, tournamentId, methods } = scoreFirstMatchUp();
    const args = { methods, tournamentIds: [tournamentId], tournamentRecords: { [tournamentId]: tournamentRecord } };

    delete process.env.SHARD_SHADOW_SAMPLE_RATE;
    expect(planShardShadow(args)).toBeUndefined();

    process.env.SHARD_SHADOW_SAMPLE_RATE = '0.5';
    expect(planShardShadow({ ...args, random: () => 0.7 })).toBeUndefined();
    expect(planShardShadow({ ...args, random: () => 0.2 })).toBeDefined();
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

  // the pipeline is the factory's, process-wide: executionQueue plans with the one the mutation engine runs, and the
  // shadow engine runs that same one, so the spec sets it for both
  it.each(['v1', 'v2'] as const)(
    'a draw-bounded score entry gives the same draw on the partial record: match (%s)',
    async (outcomePipeline) => {
      tournamentEngine.outcomePipeline(outcomePipeline);
      try {
        const { tournamentRecord, tournamentId, drawId, methods } = scoreFirstMatchUp();
        const plan = planShardShadow({
          methods,
          tournamentIds: [tournamentId],
          tournamentRecords: { [tournamentId]: tournamentRecord },
          outcomePipeline,
        });
        // The partial record carries exactly the participants the footprint declares: v1 resolves a TEAM line's sides
        // against every participant (`participants`); v2 against those the draw references (`drawParticipants`, since
        // factory 7.42.0; none before). Asserting the declared shard, not a count, keeps this true across that change.
        const shards: string[] = plan?.footprint?.shards ?? [];
        const drawParticipantIds = tournamentRecord.events
          .flatMap((e: any) => e.drawDefinitions ?? [])
          .find((d: any) => d.drawId === drawId)
          .entries.map((entry: any) => entry.participantId);
        let expected: string[] = [];
        if (shards.includes('participants')) expected = tournamentRecord.participants.map((p: any) => p.participantId);
        else if (shards.includes('drawParticipants')) expected = drawParticipantIds;
        expect(outcomePipeline === 'v1' ? shards.includes('participants') : !shards.includes('participants')).toBe(
          true,
        );
        const loaded = (plan?.partialRecord.participants ?? []).map((p: any) => p.participantId);
        expect([...loaded].sort()).toEqual([...expected].sort());
        expect(loaded.length).toBeLessThan(outcomePipeline === 'v1' ? Infinity : tournamentRecord.participants.length);
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
      } finally {
        tournamentEngine.outcomePipeline('v1');
      }
    },
  );

  it.each([false, true])(
    'matches the JSONB score shape held by the mutation engine (stored null: %s)',
    async (withNull) => {
      const { tournamentRecord, tournamentId, drawId, methods } = scoreFirstMatchUp();
      const stored: any = structuredClone(tournamentRecord);
      const draw = stored.events.flatMap((event: any) => event.drawDefinitions).find((d: any) => d.drawId === drawId);
      const other = draw.structures[0].matchUps.find((m: any) => m.matchUpId !== methods[0].params.matchUpId);
      other.score = { server: withNull ? { player: null } : {} };
      // Reproduce the JSON wire/storage boundary, including a literal null on a different match.
      const serialized = JSON.stringify({ [tournamentId]: stored });
      const records = JSON.parse(serialized);
      const plan = planShardShadow({ tournamentIds: [tournamentId], methods, tournamentRecords: records });
      const batch = await asyncGlobalState.runWithInstanceState(async () => {
        const engine = asyncEngine();
        if (!('executionQueue' in engine)) throw Error('ENGINE_INITIALIZATION_FAILED');
        expect(loadFetchedRecords(records)).toEqual({ success: true });
        const result: any = await engine.executionQueue(methods);
        expect(result.success).toBe(true);
        return captureShardShadow(plan, asyncGlobalState.getTournamentRecords());
      });
      const saved = batch!.savedDraws[drawId].structures[0].matchUps.find((m: any) => m.matchUpId === other.matchUpId);
      expect(Object.prototype.hasOwnProperty.call(saved.score.server, 'player')).toBe(withNull);
      if (withNull) expect(saved.score.server.player).toBeNull();
      expect(await runShardShadow(structuredClone(batch!))).toBe('match');
      if (withNull) {
        // Falsify the detector: only the private partial record loses this one stored key.
        const partial = batch!.partialRecord.events
          .flatMap((e: any) => e.drawDefinitions)
          .find((d: any) => d.drawId === drawId);
        delete partial.structures[0].matchUps.find((m: any) => m.matchUpId === other.matchUpId).score.server.player;
        const logged = vi.spyOn(Logger, 'error');
        try {
          expect(await runShardShadow(batch!)).toBe('mismatch');
          expect(logged).toHaveBeenCalledWith(
            expect.stringMatching(/score\.server\.player saved=null shadow=missing/),
            'ShardShadow',
          );
        } finally {
          logged.mockRestore();
        }
      }
    },
  );

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
