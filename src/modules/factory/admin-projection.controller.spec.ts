import { AdminProjectionController } from './admin-projection.controller';

// The controller is a thin, guarded delegate over ProjectionRebuildService; these
// assert it forwards the right arguments and wraps the service result. The
// SUPER_ADMIN guard is applied via @UseGuards/@Roles metadata (exercised by the
// Nest RolesGuard at runtime), not re-tested here.
describe('AdminProjectionController', () => {
  const makeRebuild = () => ({
    rebuildAll: jest.fn(async () => ({ requested: 3, rebuilt: 3, failed: [], deltas: 42 })),
    rebuildTournament: jest.fn(async () => 7),
  });

  it('rebuildAll forwards the body and wraps the result', async () => {
    const rebuild = makeRebuild();
    const ctrl = new AdminProjectionController(rebuild as any);

    const res = await ctrl.rebuildAll({ batchSize: 25 });

    expect(rebuild.rebuildAll).toHaveBeenCalledWith({ batchSize: 25 });
    expect(res).toEqual({ success: true, requested: 3, rebuilt: 3, failed: [], deltas: 42 });
  });

  it('rebuildAll defaults the body to {} when omitted', async () => {
    const rebuild = makeRebuild();
    const ctrl = new AdminProjectionController(rebuild as any);

    await ctrl.rebuildAll(undefined);

    expect(rebuild.rebuildAll).toHaveBeenCalledWith({});
  });

  it('rebuildOne forwards the tournamentId and returns the delta count', async () => {
    const rebuild = makeRebuild();
    const ctrl = new AdminProjectionController(rebuild as any);

    const res = await ctrl.rebuildOne('t-123');

    expect(rebuild.rebuildTournament).toHaveBeenCalledWith('t-123');
    expect(res).toEqual({ success: true, tournamentId: 't-123', deltas: 7 });
  });
});
