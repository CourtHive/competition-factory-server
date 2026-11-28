import { mocksEngine, tournamentEngine } from 'tods-competition-factory';
import { allTournamentMatchUps } from './allTournamentMatchUps';
import { FactoryController } from '../../factory.controller';

import type { ITournamentStorage } from 'src/storage/interfaces';
import { defined } from '../../../../tests/helpers/defined';

// POST /factory/matchups advertised eventId and drawId, but the factory's allTournamentMatchUps reads neither: every
// caller got the whole tournament. And its cache was keyed on the tournament alone, so a matchUpStatuses answer was
// served to the next caller whatever they asked for.

function published() {
  const {
    tournamentRecord,
    eventIds: [firstEventId, secondEventId],
    drawIds: [firstDrawId, secondDrawId],
  } = mocksEngine.generateTournamentRecord({
    drawProfiles: [{ drawSize: 8 }, { drawSize: 4 }],
    completeAllMatchUps: false,
  });
  tournamentEngine.setState(tournamentRecord);
  for (const eventId of [firstEventId, secondEventId]) tournamentEngine.publishEvent({ eventId });
  const record = defined(tournamentEngine.getTournament().tournamentRecord, 'tournamentRecord');
  const storage = {
    fetchTournamentRecords: async () => ({ tournamentRecords: { [record.tournamentId]: record } }),
  } as unknown as ITournamentStorage;
  return { record, storage, firstEventId, firstDrawId, secondDrawId };
}

describe('allTournamentMatchUps (POST /factory/matchups)', () => {
  it('returns only the requested draw, and only the requested event', async () => {
    const { record, storage, firstEventId, firstDrawId, secondDrawId } = published();
    const { tournamentId } = record;

    const all: any = await allTournamentMatchUps({ tournamentId }, storage);
    expect(all.matchUps.length).toEqual(7 + 3);

    const byDraw: any = await allTournamentMatchUps({ tournamentId, drawId: secondDrawId }, storage);
    expect(byDraw.matchUps.length).toEqual(3);
    expect(byDraw.matchUps.every((m) => m.drawId === secondDrawId)).toEqual(true);

    const byEvent: any = await allTournamentMatchUps({ tournamentId, eventId: firstEventId }, storage);
    expect(byEvent.matchUps.length).toEqual(7);
    expect(byEvent.matchUps.every((m) => m.drawId === firstDrawId)).toEqual(true);
  });

  it('still filters by matchUpStatuses', async () => {
    const { record, storage } = published();
    const { tournamentId } = record;
    const result: any = await allTournamentMatchUps({ tournamentId, matchUpStatuses: ['COMPLETED'] }, storage);
    expect(result.matchUps).toEqual([]);
  });
});

describe('POST /factory/matchups cache key', () => {
  function build() {
    const entries = new Map<string, any>();
    const cache: any = {
      get: vi.fn(async (key: string) => entries.get(key)),
      set: vi.fn((key: string, value: any) => entries.set(key, value)),
      del: vi.fn(async (key: string) => entries.delete(key)),
    };
    const service: any = {
      canReadUnpublishedTournament: vi.fn(async () => true),
      getMatchUps: vi.fn(async (params: any) => ({ matchUps: [], asked: params })),
    };
    const controller = new FactoryController(service, {} as any, {} as any, {} as any, cache);
    return { controller, service, entries };
  }

  it('does not serve one filter set the answer cached for another', async () => {
    const { controller, service } = build();
    const asks = [
      { tournamentId: 't1' },
      { tournamentId: 't1', eventId: 'e1' },
      { tournamentId: 't1', drawId: 'd1' },
      { tournamentId: 't1', matchUpStatuses: ['COMPLETED'] },
      { tournamentId: 't1', matchUpStatuses: ['IN_PROGRESS'] },
    ];
    for (const ask of asks) {
      const result: any = await controller.getMatchUps(ask as any);
      expect(result.asked).toEqual(ask);
    }
    expect(service.getMatchUps).toHaveBeenCalledTimes(asks.length);
  });

  it('shares one entry for the same statuses in another order, and keeps the tournament in segment one', async () => {
    const { controller, service, entries } = build();
    await controller.getMatchUps({ tournamentId: 't1', matchUpStatuses: ['COMPLETED', 'IN_PROGRESS'] } as any);
    await controller.getMatchUps({ tournamentId: 't1', matchUpStatuses: ['IN_PROGRESS', 'COMPLETED'] } as any);
    expect(service.getMatchUps).toHaveBeenCalledTimes(1);
    // Write eviction finds a tournament's keys by segment [1] (trackTournamentKey).
    expect([...entries.keys()]).toEqual(['gmr|t1|s:COMPLETED,IN_PROGRESS']);
  });

  it("evicts every filtered variant on a write to the tournament, and spares another tournament's", async () => {
    // clearCache in getMutationEngine deletes only the bare gmr|<tid>; the variants rely on the side-table sweep.
    const { controller, entries } = build();
    await controller.getMatchUps({ tournamentId: 't1', drawId: 'd1' } as any);
    await controller.getMatchUps({ tournamentId: 't1', eventId: 'e1', matchUpStatuses: ['COMPLETED'] } as any);
    await controller.getMatchUps({ tournamentId: 't2', drawId: 'd1' } as any);
    (controller as any).invalidateTournamentCache(['t1']);
    expect([...entries.keys()]).toEqual(['gmr|t2|d:d1']);
  });
});
