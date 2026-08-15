import { queryGovernor } from 'tods-competition-factory';
import { FactoryService } from './factory.service';

// Access is mocked so the coordination-view author/view split is deterministic without a real
// access-scoping env: a tournamentId containing "view" is not authorable.
jest.mock('./helpers/checkTournamentAccess', () => ({
  canViewTournament: () => true,
  canMutateTournament: (record: any) => !String(record?.tournamentId ?? '').includes('view'),
}));

// Infra-free unit test of the access/aggregation logic added to FactoryService.getScheduleProjection.
// fetchTournamentRecords (the canViewTournament gate) is stubbed; queryGovernor.getScheduleProjection
// runs for real against a trivial record (no events → empty cells).
describe('FactoryService.getScheduleProjection', () => {
  function makeService(fetchImpl: any): any {
    const service: any = Object.create(FactoryService.prototype);
    service.fetchTournamentRecords = fetchImpl;
    return service;
  }

  it('rejects a missing or empty tournamentIds', async () => {
    const service = makeService(async () => ({ tournamentRecords: {} }));
    expect((await service.getScheduleProjection({}, undefined)).error).toBe('Missing tournamentIds');
    expect((await service.getScheduleProjection({ tournamentIds: [] }, undefined)).error).toBe('Missing tournamentIds');
  });

  it('propagates a fetch error', async () => {
    const service = makeService(async () => ({ error: 'boom' }));
    const result = await service.getScheduleProjection({ tournamentIds: ['t1'] }, undefined);
    expect(result.error).toBe('boom');
  });

  it('rejects when a requested tournament is not viewable (filtered out by the access gate)', async () => {
    // gate returns only t1 → t2 was not viewable
    const service = makeService(async () => ({ tournamentRecords: { t1: { tournamentId: 't1' } } }));
    const result = await service.getScheduleProjection({ tournamentIds: ['t1', 't2'] }, undefined);
    expect(result.error).toBe('User not allowed');
    expect(result.forbiddenTournamentIds).toEqual(['t2']);
  });

  it('aggregates schedule cells for viewable tournaments', async () => {
    const service = makeService(async () => ({ tournamentRecords: { t1: { tournamentId: 't1' } } }));
    const result = await service.getScheduleProjection({ tournamentIds: ['t1'] }, undefined);
    // trivial record has no scheduled matchUps → empty, but the aggregation path ran without error
    expect(result.scheduleCells).toEqual([]);
    expect(result.error).toBeUndefined();
  });
});

describe('FactoryService.getScheduleProjection — coordination view', () => {
  const userContext: any = { userId: 'u1' };

  function makeCoordService(ctx: any, peers: Record<string, any>): any {
    const service: any = Object.create(FactoryService.prototype);
    // context fetch (view-gated) — returns ctx only when it is the one requested
    service.fetchTournamentRecords = async ({ tournamentIds }: any) => ({
      tournamentRecords: tournamentIds?.[0] === ctx.tournamentId ? { [ctx.tournamentId]: ctx } : {},
    });
    // peer fetch (ungated storage)
    service.tournamentStorageService = { fetchTournamentRecords: async () => ({ tournamentRecords: peers }) };
    service.assignmentsService = { getAssignedTournamentIds: async () => new Set() };
    return service;
  }

  afterEach(() => jest.restoreAllMocks());

  it('rejects when the caller cannot author the context tournament', async () => {
    const ctx = { tournamentId: 'view-ctx', linkedTournamentIds: ['view-ctx', 'p1'] }; // "view" → not authorable
    const service = makeCoordService(ctx, {});
    const result = await service.getScheduleProjection({ tournamentId: 'view-ctx' }, undefined, userContext);
    expect(result.error).toBe('User not allowed');
  });

  it('returns no cells when the authored context has no linked peers', async () => {
    const ctx = { tournamentId: 'ctx', linkedTournamentIds: ['ctx'] };
    const service = makeCoordService(ctx, {});
    const result = await service.getScheduleProjection({ tournamentId: 'ctx' }, undefined, userContext);
    expect(result.scheduleCells).toEqual([]);
  });

  it('tags author peers with full cells and view peers with opaque cells', async () => {
    const ctx = { tournamentId: 'ctx', linkedTournamentIds: ['ctx', 'author-peer', 'view-peer'] };
    const peers = {
      'author-peer': { tournamentId: 'author-peer', tournamentName: 'My Other Tournament' },
      'view-peer': { tournamentId: 'view-peer', tournamentName: 'Somebody Else Open' },
    };
    const service = makeCoordService(ctx, peers);
    jest.spyOn(queryGovernor, 'getScheduleProjection').mockImplementation(({ tournamentRecord }: any) => ({
      scheduleCells: [
        {
          tournamentId: tournamentRecord.tournamentId,
          courtId: 'c1',
          courtOrder: 1,
          venueId: 'v1',
          scheduledDate: '2026-07-20',
          scheduledTime: '10:00',
          roundName: 'QF',
          matchUpId: 'm1',
          labels: ['Secret Player'],
        },
      ],
    }));

    const result = await service.getScheduleProjection({ tournamentId: 'ctx' }, undefined, userContext);
    const byTournament = Object.fromEntries(result.scheduleCells.map((c: any) => [c.tournamentId, c]));

    // author peer: full cell, access author, retains participant/round detail
    expect(byTournament['author-peer']).toMatchObject({ access: 'author', labels: ['Secret Player'], roundName: 'QF' });
    // view peer: opaque cell — court occupancy only, no labels/round/matchUpId
    expect(byTournament['view-peer']).toMatchObject({ access: 'view', courtId: 'c1', courtOrder: 1, scheduledTime: '10:00' });
    expect(byTournament['view-peer'].labels).toBeUndefined();
    expect(byTournament['view-peer'].roundName).toBeUndefined();
    expect(byTournament['view-peer'].matchUpId).toBeUndefined();
  });

  it('names author peers and NEVER names view peers', async () => {
    // The client labels a reserved cell with the peer tournament name so a director can see which of
    // their OWN linked tournaments holds a court. Naming a `view` peer would break the invariant that
    // a reserved cell reveals a court is taken, never by whom.
    const ctx = { tournamentId: 'ctx', linkedTournamentIds: ['ctx', 'author-peer', 'view-peer'] };
    const peers = {
      'author-peer': { tournamentId: 'author-peer', tournamentName: 'My Other Tournament' },
      'view-peer': { tournamentId: 'view-peer', tournamentName: 'Somebody Else Open' },
    };
    const service = makeCoordService(ctx, peers);
    jest.spyOn(queryGovernor, 'getScheduleProjection').mockImplementation(({ tournamentRecord }: any) => ({
      scheduleCells: [
        { tournamentId: tournamentRecord.tournamentId, courtId: 'c1', courtOrder: 1, matchUpId: 'm1', labels: [] },
      ],
    }));

    const result = await service.getScheduleProjection({ tournamentId: 'ctx' }, undefined, userContext);
    const byTournament = Object.fromEntries(result.scheduleCells.map((c: any) => [c.tournamentId, c]));

    expect(byTournament['author-peer'].tournamentName).toEqual('My Other Tournament');
    expect(byTournament['view-peer'].tournamentName).toBeUndefined();
  });
});
