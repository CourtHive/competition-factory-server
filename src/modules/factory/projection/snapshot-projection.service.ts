import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { PROJECTION_OUTBOX_STORAGE, type IProjectionOutboxStorage } from 'src/storage/interfaces';
import asyncGlobalState from 'src/modules/factory/engines/asyncGlobalState';
import { buildSnapshotDeltas } from './buildSnapshotDeltas';

/**
 * Enqueues a full-snapshot projection span for a wholesale tournamentRecord
 * replacement. See buildSnapshotDeltas.ts for why the incremental delta path
 * cannot express one.
 *
 * Called from the save path INSIDE the per-tournament lock and AFTER the record
 * commits, mirroring where executionQueue flushes its delta buffer. Two reasons
 * that placement matters:
 *
 *   - inside the lock, so the snapshot cannot interleave with a concurrent
 *     mutation's deltas and erase them;
 *   - after the save, so the read model can never get ahead of the record.
 *
 * Enqueueing is synchronous (bulk INSERT into the outbox) while APPLYING is the
 * consumer's asynchronous problem — that keeps `seq` ordering correct without
 * putting the expensive work on the request path.
 *
 * Fail-soft, per the existing outbox producers: a projection failure is counted
 * and logged but never fails the save. The record is the source of truth and a
 * rebuild backstops the read model. Per A2 the failures are counted with
 * throttled milestones and a recovery line, because a silently-failing projector
 * looks exactly like a system with nothing to project.
 */
@Injectable()
export class SnapshotProjectionService {
  private readonly logger = new Logger(SnapshotProjectionService.name);
  private failures = 0;

  constructor(@Inject(PROJECTION_OUTBOX_STORAGE) private readonly outbox: IProjectionOutboxStorage) {}

  get isEnabled(): boolean {
    return this.outbox.isEnabled;
  }

  /**
   * Project and enqueue snapshots for every record in a wholesale save.
   * Returns the number of deltas enqueued (0 when the outbox is disabled).
   */
  async enqueueSnapshots({
    tournamentRecords,
    source,
  }: {
    tournamentRecords: Record<string, any>;
    source: string;
  }): Promise<number> {
    if (!this.outbox.isEnabled) return 0;

    let enqueued = 0;
    for (const tournamentId of Object.keys(tournamentRecords ?? {})) {
      try {
        const deltas = await asyncGlobalState.runWithInstanceState(async () =>
          buildSnapshotDeltas({
            tournamentRecord: tournamentRecords[tournamentId],
            snapshotId: randomUUID(),
            source,
          }),
        );
        if (!deltas.length) continue;

        // One enqueue call per tournament: the span must land contiguously and
        // in order, so it is never split across calls that another producer
        // could interleave with.
        await this.outbox.enqueue(deltas);
        enqueued += deltas.length;
        this.recordRecovery();
      } catch (err: any) {
        this.recordFailure(tournamentId, err);
      }
    }
    return enqueued;
  }

  private recordFailure(tournamentId: string, err: Error): void {
    this.failures += 1;
    const isMilestone =
      this.failures === 1 || this.failures === 10 || this.failures === 100 || this.failures % 50 === 0;
    const message =
      `Snapshot projection failed (${this.failures}x) for tournament ${tournamentId}: ${err.message}. ` +
      `The record saved; the read model is stale for this tournament until a rebuild.`;
    if (isMilestone) this.logger.error(message);
    else this.logger.debug(message);
  }

  private recordRecovery(): void {
    if (!this.failures) return;
    const previous = this.failures;
    this.failures = 0;
    this.logger.warn(`Snapshot projection recovered after ${previous} failure(s)`);
  }
}
