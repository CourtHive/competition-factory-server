import { FactoryService } from './factory.service';

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
