import { mocksEngine, tournamentEngine } from 'tods-competition-factory';
import { executionQueue } from './executionQueue';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';

/**
 * A matchUpId-only score entry (score-relay producers know no drawId) takes its draw from `match_up_index` inside the
 * lock, BEFORE the record is fetched, when the storage has one for the tournament; otherwise from the fetched record,
 * as before. The first is what a footprint-driven fetch needs: the draws named before anything is loaded.
 */
const {
  tournamentRecord: template,
  drawIds: [drawId],
} = mocksEngine.generateTournamentRecord({ drawProfiles: [{ drawSize: 8 }, { drawSize: 4 }] });
const tournamentId = template.tournamentId;

tournamentEngine.setState(template);
const matchUp: any = tournamentEngine
  .allTournamentMatchUps({ inContext: true })
  .matchUps?.find((m: any) => m.drawId === drawId && m.roundNumber === 1);

const scoreEntry = (params: any = {}) => ({
  method: 'setMatchUpStatus',
  params: {
    matchUpId: matchUp.matchUpId,
    outcome: {
      winningSide: 1,
      matchUpStatus: 'COMPLETED',
      sets: [{ setNumber: 1, side1Score: 6, side2Score: 0, winningSide: 1 }],
    },
    ...params,
  },
});

function storage(indexed: Record<string, { drawId: string; eventId?: string }>) {
  const atFetch: { drawId?: string; eventId?: string }[] = [];
  let methods: any[] = [];
  const persisted = {
    atFetch,
    watch: (queue: any[]) => (methods = queue),
    fetchMatchUpDraws: vi.fn(async () => indexed),
    fetchTournamentRecords: vi.fn(async () => {
      atFetch.push(...methods.map(({ params }) => ({ drawId: params.drawId, eventId: params.eventId })));
      return { success: true, tournamentRecords: { [tournamentId]: structuredClone(template) } };
    }),
    saveTournamentRecords: vi.fn(async () => ({ success: true })),
  };
  return persisted;
}

const run = async (persisted: ReturnType<typeof storage>, methods: any[]) => {
  persisted.watch(methods);
  return executionQueue(
    { tournamentIds: [tournamentId], methods },
    undefined,
    persisted as unknown as TournamentStorageService,
  );
};

describe('executionQueue resolves a matchUpId-only score entry', () => {
  it('from match_up_index, before the record is fetched', async () => {
    const persisted = storage({ [matchUp.matchUpId]: { drawId, eventId: matchUp.eventId } });
    const methods = [scoreEntry()];
    const result: any = await run(persisted, methods);

    expect(result.success).toBe(true);
    expect(persisted.fetchMatchUpDraws).toHaveBeenCalledWith({ tournamentId, matchUpIds: [matchUp.matchUpId] });
    expect(persisted.atFetch).toEqual([{ drawId, eventId: matchUp.eventId }]);
  });

  it('from the fetched record when the index names nothing (a document tournament)', async () => {
    const persisted = storage({});
    const methods = [scoreEntry()];
    const result: any = await run(persisted, methods);

    expect(result.success).toBe(true);
    expect(persisted.atFetch).toEqual([{ drawId: undefined, eventId: undefined }]);
    expect(methods[0].params.drawId).toBe(drawId);
  });

  it('asks the index nothing when every entry names its draw', async () => {
    const persisted = storage({});
    const result: any = await run(persisted, [scoreEntry({ drawId })]);

    expect(result.success).toBe(true);
    expect(persisted.fetchMatchUpDraws).not.toHaveBeenCalled();
  });
});
