import { mocksEngine, readModel } from 'tods-competition-factory';
import { runWithRequestContext } from '../engines/requestContext';
import { getMutationEngine } from '../engines/getMutationEngine';
import { buildProjectionDeltas } from './buildProjectionDeltas';
import asyncGlobalState from '../engines/asyncGlobalState';
import { createDeltaBuffer } from './deltaBuffer';
import { describe, expect, it } from 'vitest';

describe('individual merge projections', () => {
  it('moves competitor references and entries through real async engine notices', async () => {
    const { tournamentRecord } = await asyncGlobalState.runWithInstanceState(async () =>
      mocksEngine.generateTournamentRecord({
        drawProfiles: [{ drawSize: 4 }],
        nonRandom: 1,
      }),
    );
    const source = tournamentRecord.participants.find((p: any) => p.participantType === 'INDIVIDUAL');
    const target = { ...structuredClone(source), participantId: 'retained-individual' };
    tournamentRecord.participants.push(target);
    const tid = tournamentRecord.tournamentId;
    const deltaBuffer = createDeltaBuffer([tid]);
    await runWithRequestContext({ deltaBuffer, publicNotices: [] }, () =>
      asyncGlobalState.runWithInstanceState(async () => {
        const engine: any = getMutationEngine();
        await engine.setState(tournamentRecord);
        const args = { sourceParticipantId: source.participantId, targetParticipantId: target.participantId };
        const preview = await engine.execute({ method: 'getIndividualParticipantMergePreview', params: args });
        expect(preview.canMerge).toBe(true);
        const queued = await engine.executionQueue([
          { method: 'mergeIndividualParticipants', params: { ...args, expectedFingerprint: preview.fingerprint } },
        ]);
        let result: any = queued.results[0];
        expect(result.success).toBe(true);
        expect(result.mergeReceipt.before.participants.some((p: any) => p.participantId === source.participantId)).toBe(
          true,
        );
        const record = (await engine.getTournament()).tournamentRecord;
        expect(deltaBuffer.intents.some((intent) => intent.kind === 'deleteParticipants')).toBe(true);
        expect(deltaBuffer.intents.some((intent) => intent.kind === 'matchUpResult')).toBe(true);
        const deltas = await buildProjectionDeltas({
          intents: deltaBuffer.intents,
          tournamentRecords: { [tid]: record },
          flattenDraw: async (_tid, drawId) =>
            (
              await engine.execute({
                method: 'allTournamentMatchUps',
                params: { matchUpFilters: { drawIds: [drawId] } },
              })
            ).matchUps ?? [],
        });
        const competitors = deltas
          .filter((delta) => delta.table === 'match_up_competitors' && delta.op === 'upsert')
          .map((delta) => delta.row);
        expect(competitors.some((row: any) => row.individual_participant_id === target.participantId)).toBe(true);
        expect(competitors.some((row: any) => row.individual_participant_id === source.participantId)).toBe(false);
        const expected: any = readModel.cast({ tournamentRecord: record }).rows;
        for (const row of competitors) expect(expected.match_up_competitors).toContainEqual(row);
      }),
    );
  });
});
