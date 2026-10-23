import { mocksEngine } from 'tods-competition-factory';

import { SnapshotProjectionService } from './snapshot-projection.service';
import { drainSnapshotRequests } from './snapshotProducer';

/**
 * Deferred snapshots (Mentat/planning/CFS_LARGE_SAVES.md §10): a wholesale save records a request instead of building
 * the span on the request path, and the Projection-Producer serves it from the stored record through the fence.
 */
function makeRecord() {
  return mocksEngine.generateTournamentRecord({ drawProfiles: [{ drawSize: 4 }], nonRandom: 1 }).tournamentRecord;
}

function fakeOutbox(overrides: any = {}) {
  return {
    isEnabled: true,
    enqueue: vi.fn(),
    requestSnapshots: vi.fn(),
    readForProjection: vi.fn(),
    enqueueIfUnchanged: vi.fn(),
    pendingSnapshotRequests: vi.fn().mockResolvedValue([]),
    completeSnapshot: vi.fn().mockResolvedValue('enqueued'),
    recordSnapshotFailure: vi.fn(),
    ...overrides,
  } as any;
}

describe('SnapshotProjectionService.enqueueSnapshots — mode', () => {
  const original = process.env.PROJECTION_SNAPSHOT_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.PROJECTION_SNAPSHOT_MODE;
    else process.env.PROJECTION_SNAPSHOT_MODE = original;
  });

  it('builds and enqueues the span on the request path by default', async () => {
    delete process.env.PROJECTION_SNAPSHOT_MODE;
    const outbox = fakeOutbox();
    const record = makeRecord();

    const count = await new SnapshotProjectionService(outbox).enqueueSnapshots({
      tournamentRecords: { [record.tournamentId]: record },
      source: 'factory-save',
    });

    expect(count).toBeGreaterThan(0);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.requestSnapshots).not.toHaveBeenCalled();
  });

  it('records a request and builds nothing when deferred', async () => {
    process.env.PROJECTION_SNAPSHOT_MODE = 'deferred';
    const outbox = fakeOutbox();
    const record = makeRecord();

    const count = await new SnapshotProjectionService(outbox).enqueueSnapshots({
      tournamentRecords: { [record.tournamentId]: record },
      source: 'factory-save',
    });

    expect(count).toBe(0);
    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(outbox.requestSnapshots).toHaveBeenCalledWith([record.tournamentId], 'factory-save');
  });
});

describe('drainSnapshotRequests', () => {
  const request = (tournamentId: string, attempts = 0) => ({
    tournamentId,
    requestedAt: 'r1',
    source: 'factory-save',
    attempts,
  });

  it('builds the span from the stored record and commits it through the fence', async () => {
    const record = makeRecord();
    const outbox = fakeOutbox({
      pendingSnapshotRequests: vi.fn().mockResolvedValue([request(record.tournamentId)]),
      readForProjection: vi.fn().mockResolvedValue({ tournamentRecord: record, updatedAt: 'v1' }),
    });

    const result = await drainSnapshotRequests(outbox);

    expect(result).toEqual({ examined: 1, enqueued: 1, changed: 0, missing: 0, failed: 0 });
    const call = outbox.completeSnapshot.mock.calls[0][0];
    expect(call).toMatchObject({ tournamentId: record.tournamentId, requestedAt: 'r1', updatedAt: 'v1' });
    expect(call.deltas[0].op).toBe('snapshot_begin');
    expect(call.deltas[call.deltas.length - 1].op).toBe('snapshot_end');
  });

  it('leaves a request whose record changed during the build for the next drain', async () => {
    const record = makeRecord();
    const outbox = fakeOutbox({
      pendingSnapshotRequests: vi.fn().mockResolvedValue([request(record.tournamentId)]),
      readForProjection: vi.fn().mockResolvedValue({ tournamentRecord: record, updatedAt: 'v1' }),
      completeSnapshot: vi.fn().mockResolvedValue('changed'),
    });

    expect(await drainSnapshotRequests(outbox)).toMatchObject({ changed: 1, enqueued: 0 });
  });

  it('closes the request of a tournament that no longer exists', async () => {
    const outbox = fakeOutbox({
      pendingSnapshotRequests: vi.fn().mockResolvedValue([request('gone')]),
      readForProjection: vi.fn().mockResolvedValue(undefined),
      completeSnapshot: vi.fn().mockResolvedValue('missing'),
    });

    expect(await drainSnapshotRequests(outbox)).toMatchObject({ missing: 1 });
    expect(outbox.completeSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tournamentId: 'gone', deltas: [] }));
  });

  // A failed build stays a durable request with its error, where an inline failure left the tournament stale silently
  it('records a failed build against its request and moves on', async () => {
    const outbox = fakeOutbox({
      pendingSnapshotRequests: vi.fn().mockResolvedValue([request('t-1'), request('t-2')]),
      readForProjection: vi.fn().mockRejectedValueOnce(new Error('read failed')).mockResolvedValue(undefined),
      completeSnapshot: vi.fn().mockResolvedValue('missing'),
    });

    const result = await drainSnapshotRequests(outbox);

    expect(result).toMatchObject({ examined: 2, failed: 1, missing: 1 });
    expect(outbox.recordSnapshotFailure).toHaveBeenCalledWith('t-1', 'read failed');
  });

  it('stops retrying a request after its attempts are spent', async () => {
    const outbox = fakeOutbox({ pendingSnapshotRequests: vi.fn().mockResolvedValue([request('t-1', 5)]) });
    expect(await drainSnapshotRequests(outbox)).toMatchObject({ examined: 0 });
    expect(outbox.readForProjection).not.toHaveBeenCalled();
  });
});
