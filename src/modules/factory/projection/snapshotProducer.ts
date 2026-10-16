import { randomUUID } from 'node:crypto';

import type { IProjectionOutboxStorage, SnapshotRequest } from 'src/storage/interfaces';
import asyncGlobalState from 'src/modules/factory/engines/asyncGlobalState';
import { buildSnapshotDeltas } from './buildSnapshotDeltas';

export interface DrainResult {
  examined: number;
  enqueued: number;
  /** A save landed between the read and the fence; the request stays and is built again next drain. */
  changed: number;
  missing: number;
  failed: number;
}

/**
 * Build the snapshot spans that wholesale saves requested in deferred mode (Mentat/planning/CFS_LARGE_SAVES.md §10).
 *
 * Each request is served from the STORED record, read outside the tournament lock, and committed through the outbox's
 * fence: the span is inserted only if `tournaments.updated_at` is still the value read, in the same transaction that
 * deletes the request. Why that converges with the incremental deltas: every save that committed before the fence is
 * already in the record read, so the span supersedes its rows; a save after the fence waits on the share lock and
 * enqueues after the span. A failed build stays a durable request, counted and kept for retry — where an inline
 * failure used to leave the tournament stale until a manual rebuild.
 */
export async function drainSnapshotRequests(
  outbox: IProjectionOutboxStorage,
  { limit = 25, maxAttempts = 5 }: { limit?: number; maxAttempts?: number } = {},
): Promise<DrainResult> {
  const result: DrainResult = { examined: 0, enqueued: 0, changed: 0, missing: 0, failed: 0 };
  const requests = (await outbox.pendingSnapshotRequests(limit)).filter((request) => request.attempts < maxAttempts);

  for (const request of requests) {
    result.examined += 1;
    try {
      const outcome = await serve(outbox, request);
      result[outcome] += 1;
    } catch (err: any) {
      result.failed += 1;
      await outbox.recordSnapshotFailure(request.tournamentId, err?.message ?? String(err));
    }
  }
  return result;
}

async function serve(outbox: IProjectionOutboxStorage, request: SnapshotRequest) {
  const { tournamentId, requestedAt } = request;
  const source = await outbox.readForProjection(tournamentId);
  if (!source) {
    return outbox.completeSnapshot({ tournamentId, requestedAt, updatedAt: '', deltas: [] });
  }
  const deltas = await asyncGlobalState.runWithInstanceState(async () =>
    buildSnapshotDeltas({
      tournamentRecord: source.tournamentRecord,
      snapshotId: randomUUID(),
      source: request.source ?? 'deferred',
    }),
  );
  return outbox.completeSnapshot({ tournamentId, requestedAt, updatedAt: source.updatedAt, deltas });
}
