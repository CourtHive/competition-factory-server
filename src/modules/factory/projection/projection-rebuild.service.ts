import asyncGlobalState from 'src/modules/factory/engines/asyncGlobalState';
import { tournamentEngineAsync } from 'tods-competition-factory';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { PROJECTION_OUTBOX_STORAGE, type IProjectionOutboxStorage } from 'src/storage/interfaces';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { buildProjectionDeltas } from './buildProjectionDeltas';
import { buildRebuildIntents } from './rebuild';

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

  /** Rebuild a single tournament: project → enqueue. Returns the delta count. */
  async rebuildTournament(tournamentId: string): Promise<number> {
    const { tournamentRecord }: any = await this.storage.findTournamentRecord({ tournamentId });
    if (!tournamentRecord) return 0;

    const deltas = await buildProjectionDeltas({
      intents: buildRebuildIntents(tournamentRecord),
      tournamentRecords: { [tournamentId]: tournamentRecord },
      // own engine-state context: the rebuild is a separate entry point, not routed through
      // executionQueue, and setState here would otherwise share process-wide state
      flattenDraw: async (_tid: string, drawId: string) =>
        asyncGlobalState.runWithInstanceState(async () => {
          await tournamentEngineAsync.setState(tournamentRecord);
          const res: any = await tournamentEngineAsync.allDrawMatchUps({ drawId, inContext: true });
          return res?.matchUps ?? [];
        }),
    });
    await this.outbox.enqueue(deltas);
    return deltas.length;
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

    this.logger.log(`rebuild done: ${result.rebuilt}/${result.requested} rebuilt, ${result.deltas} deltas, ${result.failed.length} failed`);
    return result;
  }
}
