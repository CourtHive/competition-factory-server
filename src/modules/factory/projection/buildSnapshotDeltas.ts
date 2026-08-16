import { tournamentEngineAsync } from 'tods-competition-factory';

import { ProjectionDelta } from 'src/storage/interfaces/projection-outbox-storage.interface';
import { SNAPSHOT_OWNED_TABLES, TABLE_TOURNAMENTS } from './projectionConstants';
import { buildProjectionDeltas } from './buildProjectionDeltas';
import { buildRebuildIntents } from './rebuild';

/**
 * Project a COMPLETE tournamentRecord as a self-contained snapshot span.
 *
 * WHY THIS EXISTS. `/factory/save` (TMX `sendTournament`), the provider-key save,
 * commit-save, and backend pipeline loads all replace the server's stored copy of
 * a tournamentRecord wholesale. They never enter `executionQueue`, so they raise
 * no factory notices and there is no diff for the incremental delta path to
 * express.
 *
 * Reusing the rebuild intents alone is NOT sufficient, and this is the subtle
 * part: `buildRebuildIntents` derives intents from what IS in the record, so it
 * emits upserts only. Replace a record whose draw, event, or participants were
 * removed and those read-model rows survive forever — nothing ever says they are
 * gone. A snapshot therefore has to carry an explicit purge scope, which is what
 * the `snapshot_begin` marker does.
 *
 * The upserts themselves come from the SAME `buildProjectionDeltas` the
 * incremental and rebuild paths use, preserving the anti-divergence guarantee
 * (see projection-conformance.spec.ts): all three producers yield byte-identical
 * read rows for the same record.
 *
 * Ordering matters. The returned span must be enqueued as one contiguous run, in
 * order, so `seq` places it ahead of any later mutation's deltas — otherwise a
 * mutation applied between the purge and the re-insert would be erased by the
 * snapshot that follows it.
 */
export async function buildSnapshotDeltas({
  tournamentRecord,
  snapshotId,
  source,
}: {
  tournamentRecord: any;
  snapshotId: string;
  source: string;
}): Promise<ProjectionDelta[]> {
  const tournamentId = tournamentRecord?.tournamentId;
  if (!tournamentId) return [];

  const body = await buildProjectionDeltas({
    intents: buildRebuildIntents(tournamentRecord),
    tournamentRecords: { [tournamentId]: tournamentRecord },
    flattenDraw: async (_tid: string, drawId: string) => {
      await tournamentEngineAsync.setState(tournamentRecord);
      const res: any = await tournamentEngineAsync.allDrawMatchUps({ drawId, inContext: true });
      return res?.matchUps ?? [];
    },
  });

  const begin: ProjectionDelta = {
    tournamentId,
    op: 'snapshot_begin',
    // Markers are span-level, not row-level. `table` names the anchor table
    // rather than a target so the column stays non-null and readable in the
    // queue; the purge scope is `row.tables`.
    table: TABLE_TOURNAMENTS,
    key: { snapshotId },
    row: { tables: [...SNAPSHOT_OWNED_TABLES], source },
    topic: 'snapshot',
  };

  const end: ProjectionDelta = {
    tournamentId,
    op: 'snapshot_end',
    table: TABLE_TOURNAMENTS,
    key: { snapshotId },
    // Lets the consumer verify it received the whole span before committing,
    // rather than committing a truncated snapshot as though it were complete.
    row: { deltaCount: body.length, source },
    topic: 'snapshot',
  };

  return [begin, ...body, end];
}
