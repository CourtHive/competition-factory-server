import type { TournamentMetadata } from '../interfaces/tournament-storage.interface';
import { ACTIVE_SHARD_SYNC_SQL } from './physicalFootprintTrigger';
import { commandClient } from './commandTransaction';
import type { Pool } from 'pg';

/**
 * Optional singleton authorization projection for migration 062's synchronized physical layout.
 * Supply the adapter's ordinary metadata reader as fallback. Delegate the complete request on a
 * miss: a missing shell does not mean a missing tournament, and the mutation gate skips absent rows.
 * Batches retain the ordinary reader's single snapshot, ordering and duplicate-ID semantics.
 * A physical hit reads only tournament_id, updated_at and tableoid on the parent. The trigger
 * predicate checks current configuration; re-shard and verify drift after any unsynchronized writes.
 */
export async function fetchPhysicalShellMetadata(
  pool: Pool,
  tournamentIds: string[],
  fallback: (ids: string[]) => Promise<TournamentMetadata[]>,
): Promise<TournamentMetadata[]> {
  if (tournamentIds.length !== 1) return fallback(tournamentIds);

  const db = commandClient(pool) ?? pool;
  const { rows } = await db.query(
    `SELECT t.tournament_id, t.updated_at AS row_updated_at,
            s.shell->>'updatedAt' AS updated_at,
            s.shell->'parentOrganisation'->>'organisationId' AS provider_id,
            s.shell->'extensions' AS extensions
       FROM tournament_storage_layout l
       JOIN tournament_shells s USING (tournament_id)
       JOIN tournaments t USING (tournament_id)
      WHERE l.tournament_id = $1 AND l.layout = 'sharded'
        AND ${ACTIVE_SHARD_SYNC_SQL}`,
    [tournamentIds[0]],
  );
  if (!rows.length) return fallback(tournamentIds);

  const row = rows[0];
  return [
    {
      tournamentId: row.tournament_id,
      providerId: row.provider_id,
      extensions: row.extensions ?? [],
      updatedAt: row.updated_at,
      serverUpdatedAt:
        row.row_updated_at instanceof Date ? row.row_updated_at.toISOString() : String(row.row_updated_at),
    },
  ];
}
