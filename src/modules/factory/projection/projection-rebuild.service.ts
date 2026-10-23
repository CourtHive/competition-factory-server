import asyncGlobalState from 'src/modules/factory/engines/asyncGlobalState';
import { tournamentEngineAsync } from 'tods-competition-factory';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { PROJECTION_OUTBOX_STORAGE, type IProjectionOutboxStorage } from 'src/storage/interfaces';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { buildProjectionDeltas } from './buildProjectionDeltas';
import { buildRebuildIntents } from './rebuild';

/** A rebuild that keeps losing the fence to live writes gives up rather than spinning; the caller retries later. */
const MAX_FENCE_ATTEMPTS = 3;

export interface RebuildResult {
  requested: number;
  rebuilt: number;
  failed: { tournamentId: string; error: string }[];
  deltas: number;
}

/**
 * Read-model REBUILD / backfill pipeline (super-admin / offline job — NOT a
 * request path). Projects each tournament record through the SAME
 * `buildProjectionDeltas` the incremental producers use, and enqueues the deltas
 * to the outbox — so the courthive-query consumer applies them identically. Used
 * for the one-time backfill of the ~1,643 historical records and any re-sync.
 *
 * Runs off the mutation lock (loads records via storage, projects in-process,
 * enqueues) in bounded batches. Idempotent: re-running upserts the same rows.
 * Load pressure on the primary is the caller's concern (batch size + off-peak);
 * A7 permits `listTournamentIds` here because this is an offline admin job, not
 * a controller-reachable read.
 */
@Injectable()
export class ProjectionRebuildService {
  private readonly logger = new Logger(ProjectionRebuildService.name);

  constructor(
    private readonly storage: TournamentStorageService,
    @Inject(PROJECTION_OUTBOX_STORAGE) private readonly outbox: IProjectionOutboxStorage,
  ) {}

  /**
   * Rebuild a single tournament: project → enqueue. Returns the delta count.
   *
   * FENCED. The record is read outside the tournament lock, so a mutation can commit between the read and the
   * enqueue; enqueued afterwards, the rebuild's older rows would overwrite that mutation's newer ones. The deltas are
   * enqueued only if `tournaments.updated_at` is still the value read (`enqueueIfUnchanged`); otherwise the record is
   * read and projected again, up to MAX_FENCE_ATTEMPTS times.
   */
  async rebuildTournament(tournamentId: string): Promise<number> {
    for (let attempt = 1; attempt <= MAX_FENCE_ATTEMPTS; attempt += 1) {
      const source = await this.outbox.readForProjection(tournamentId);
      if (!source) return 0;
      const deltas = await this.project(tournamentId, source.tournamentRecord);
      const outcome = await this.outbox.enqueueIfUnchanged({ tournamentId, updatedAt: source.updatedAt, deltas });
      if (outcome === 'enqueued') return deltas.length;
      if (outcome === 'missing') return 0;
    }
    throw new Error(`rebuild of ${tournamentId} kept racing writes (${MAX_FENCE_ATTEMPTS} attempts); retry later`);
  }

  // ONE outer runWithInstanceState scopes the WHOLE rebuild (buildProjectionDeltas AND flattenDraw),
  // mirroring executionQueue (executionQueue.ts:76 → 159). Previously only flattenDraw was wrapped, so
  // buildProjectionDeltas' own factory reads (readModel/context resolution) ran outside any AsyncLocalStorage
  // store — each getInstanceState() then minted an isolated implicit state (~9/tournament; ~14.5k over a
  // full backfill), warning-spamming, bloating memory, and stalling the rebuild. flattenDraw now inherits
  // the outer store instead of opening its own per-draw store.
  private project(tournamentId: string, tournamentRecord: any) {
    return asyncGlobalState.runWithInstanceState(async () =>
      buildProjectionDeltas({
        intents: buildRebuildIntents(tournamentRecord),
        tournamentRecords: { [tournamentId]: tournamentRecord },
        flattenDraw: async (_tid: string, drawId: string) => {
          await tournamentEngineAsync.setState(tournamentRecord);
          const res: any = await tournamentEngineAsync.allDrawMatchUps({ drawId, inContext: true });
          return res?.matchUps ?? [];
        },
      }),
    );
  }

  /**
   * Rebuild many tournaments in bounded batches (default: all). Each tournament
   * is isolated — a failure is recorded + skipped, never aborting the run.
   */
  async rebuildAll(opts?: { tournamentIds?: string[]; batchSize?: number }): Promise<RebuildResult> {
    const tournamentIds = opts?.tournamentIds ?? (await this.storage.listTournamentIds());
    const batchSize = Math.max(1, opts?.batchSize ?? 25);
    const result: RebuildResult = { requested: tournamentIds.length, rebuilt: 0, failed: [], deltas: 0 };

    for (let i = 0; i < tournamentIds.length; i += batchSize) {
      const batch = tournamentIds.slice(i, i + batchSize);
      for (const tournamentId of batch) {
        try {
          result.deltas += await this.rebuildTournament(tournamentId);
          result.rebuilt += 1;
        } catch (err: any) {
          result.failed.push({ tournamentId, error: err?.message ?? String(err) });
          this.logger.error(`rebuild failed for ${tournamentId}: ${err?.message ?? err}`);
        }
      }
      this.logger.log(`rebuild progress: ${Math.min(i + batchSize, tournamentIds.length)}/${tournamentIds.length}`);
    }

    this.logger.log(
      `rebuild done: ${result.rebuilt}/${result.requested} rebuilt, ${result.deltas} deltas, ${result.failed.length} failed`,
    );
    return result;
  }
}
