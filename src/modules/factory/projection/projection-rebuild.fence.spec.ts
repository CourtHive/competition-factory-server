import { mocksEngine } from 'tods-competition-factory';

import { ProjectionRebuildService } from './projection-rebuild.service';

/**
 * A rebuild reads the record outside the tournament lock, so a mutation can commit before the rebuild's deltas are
 * enqueued; enqueued after it, the older rows would overwrite the newer ones. The rebuild enqueues only through the
 * fence, and projects again when the record changed (Mentat/planning/CFS_LARGE_SAVES.md §10, P4).
 */
function makeRecord() {
  return mocksEngine.generateTournamentRecord({ drawProfiles: [{ drawSize: 4 }], nonRandom: 1 }).tournamentRecord;
}

function makeService(outcomes: string[]) {
  const tournamentRecord = makeRecord();
  const outbox: any = {
    isEnabled: true,
    enqueue: vi.fn(),
    readForProjection: vi.fn().mockResolvedValue({ tournamentRecord, updatedAt: 'v1' }),
    enqueueIfUnchanged: vi.fn(),
  };
  for (const outcome of outcomes) outbox.enqueueIfUnchanged.mockResolvedValueOnce(outcome);
  const service = new ProjectionRebuildService({} as any, outbox);
  return { service, outbox, tournamentId: tournamentRecord.tournamentId };
}

describe('ProjectionRebuildService.rebuildTournament — fenced', () => {
  it('enqueues through the fence, never directly', async () => {
    const { service, outbox, tournamentId } = makeService(['enqueued']);

    const count = await service.rebuildTournament(tournamentId);

    expect(count).toBeGreaterThan(0);
    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(outbox.enqueueIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ tournamentId, updatedAt: 'v1' }));
  });

  it('reads and projects again when a write landed between the read and the fence', async () => {
    const { service, outbox, tournamentId } = makeService(['changed', 'enqueued']);

    await service.rebuildTournament(tournamentId);

    expect(outbox.readForProjection).toHaveBeenCalledTimes(2);
    expect(outbox.enqueueIfUnchanged).toHaveBeenCalledTimes(2);
  });

  it('writes nothing for a tournament deleted since it was read', async () => {
    const { service, tournamentId } = makeService(['missing']);
    expect(await service.rebuildTournament(tournamentId)).toBe(0);
  });

  it('gives up after three lost races rather than spinning', async () => {
    const { service, outbox, tournamentId } = makeService(['changed', 'changed', 'changed']);

    await expect(service.rebuildTournament(tournamentId)).rejects.toThrow(/kept racing writes/);
    expect(outbox.enqueueIfUnchanged).toHaveBeenCalledTimes(3);
  });
});
