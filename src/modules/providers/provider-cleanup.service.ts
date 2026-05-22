/**
 * Single-transaction cleanup of every row that references a provider.
 *
 * Shared by:
 *   - archive flow — exports first, then calls wipe()
 *   - delete flow — calls wipe() directly, no export
 *
 * Tables touched (in order; provider row goes LAST so the CASCADE
 * tables come along after their FK target is intact):
 *
 *   Soft-FK (must explicitly DELETE):
 *     user_providers           (provider_id)
 *     provisioner_providers    (provider_id)
 *     tournament_assignments   (provider_id)
 *     official_records         (provider_id)
 *     sanctioning_records      (applicant_provider_id)
 *     tournament_provisioner   (provider_id)
 *     pending_saves            (provider_id)
 *     calendars                (provider_abbr — KEYED BY ABBR, not id!)
 *     tournaments              (provider_id)
 *
 *   CASCADE (deleted automatically when providers row goes):
 *     provider_topologies      (FK ON DELETE CASCADE)
 *     provider_catalog_items   (FK ON DELETE CASCADE)
 *     policies                 (FK ON DELETE CASCADE)
 *
 *   Preserved (FK-free by design, survives provider deletion):
 *     audit_log                (referenced by tournament_id but no FK)
 *
 * All inside ONE transaction. Rollback on any failure leaves the live
 * DB exactly as it was. The archive export (written to disk OUTSIDE
 * this transaction) is the caller's responsibility to compute first
 * and clean up on rollback.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from 'src/storage/postgres/postgres.config';

export interface CleanupCounts {
  tournaments: number;
  userAssociations: number;
  provisionerAssociations: number;
  tournamentAssignments: number;
  officialRecords: number;
  sanctioningRecords: number;
  tournamentProvisioner: number;
  pendingSaves: number;
  calendars: number;
  // CASCADE tables — included in counts so the preview shows the full
  // blast radius even though we don't issue explicit DELETEs for them.
  topologies: number;
  catalogItems: number;
  policies: number;
  // Audit log row count for the tournaments owned by this provider.
  // NOT deleted — preserved by design. Included in counts so the
  // archive export knows how much audit history to ship.
  auditLogRows: number;
}

@Injectable()
export class ProviderCleanupService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Read-only count of rows that would be touched by `wipe()`. Used by
   * the preview-archive endpoint so the confirmation modal can show
   * the user what they're about to destroy.
   */
  async getCounts(providerId: string, providerAbbr: string): Promise<CleanupCounts> {
    const sql = `
      WITH tournament_ids AS (
        SELECT tournament_id FROM tournaments WHERE provider_id = $1
      )
      SELECT
        (SELECT COUNT(*) FROM tournaments WHERE provider_id = $1)               AS tournaments,
        (SELECT COUNT(*) FROM user_providers WHERE provider_id = $1)            AS user_associations,
        (SELECT COUNT(*) FROM provisioner_providers WHERE provider_id = $1)     AS provisioner_associations,
        (SELECT COUNT(*) FROM tournament_assignments WHERE provider_id = $1)    AS tournament_assignments,
        (SELECT COUNT(*) FROM official_records WHERE provider_id = $1)          AS official_records,
        (SELECT COUNT(*) FROM sanctioning_records WHERE applicant_provider_id = $1) AS sanctioning_records,
        (SELECT COUNT(*) FROM tournament_provisioner WHERE provider_id = $1)    AS tournament_provisioner,
        (SELECT COUNT(*) FROM pending_saves WHERE provider_id = $1)             AS pending_saves,
        (SELECT COUNT(*) FROM calendars WHERE provider_abbr = $2)               AS calendars,
        (SELECT COUNT(*) FROM provider_topologies WHERE provider_id = $1)       AS topologies,
        (SELECT COUNT(*) FROM provider_catalog_items WHERE provider_id = $1)    AS catalog_items,
        (SELECT COUNT(*) FROM policies WHERE provider_id = $1)                  AS policies,
        (SELECT COUNT(*) FROM audit_log WHERE tournament_id IN (SELECT tournament_id FROM tournament_ids)) AS audit_log_rows
    `;
    const result = await this.pool.query(sql, [providerId, providerAbbr]);
    const row = result.rows[0] ?? {};
    return {
      tournaments: Number(row.tournaments ?? 0),
      userAssociations: Number(row.user_associations ?? 0),
      provisionerAssociations: Number(row.provisioner_associations ?? 0),
      tournamentAssignments: Number(row.tournament_assignments ?? 0),
      officialRecords: Number(row.official_records ?? 0),
      sanctioningRecords: Number(row.sanctioning_records ?? 0),
      tournamentProvisioner: Number(row.tournament_provisioner ?? 0),
      pendingSaves: Number(row.pending_saves ?? 0),
      calendars: Number(row.calendars ?? 0),
      topologies: Number(row.topologies ?? 0),
      catalogItems: Number(row.catalog_items ?? 0),
      policies: Number(row.policies ?? 0),
      auditLogRows: Number(row.audit_log_rows ?? 0),
    };
  }

  /**
   * Atomic wipe — all DELETEs in a single transaction. Throws on any
   * failure (caller's responsibility to ROLLBACK any outer side effects
   * like an in-progress archive directory write).
   *
   * Returns the counts of rows actually deleted so the caller can
   * record them in `provider_archives` (or surface to logs).
   */
  async wipe(providerId: string, providerAbbr: string): Promise<CleanupCounts> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Soft-FK tables (explicit DELETE, no CASCADE here)
      const userAssoc          = await client.query('DELETE FROM user_providers WHERE provider_id = $1', [providerId]);
      const provisionerAssoc   = await client.query('DELETE FROM provisioner_providers WHERE provider_id = $1', [providerId]);
      const tournamentAssign   = await client.query('DELETE FROM tournament_assignments WHERE provider_id = $1', [providerId]);
      const officialRec        = await client.query('DELETE FROM official_records WHERE provider_id = $1', [providerId]);
      const sanctioningRec     = await client.query('DELETE FROM sanctioning_records WHERE applicant_provider_id = $1', [providerId]);
      const tournamentProv     = await client.query('DELETE FROM tournament_provisioner WHERE provider_id = $1', [providerId]);
      const pendingSaves       = await client.query('DELETE FROM pending_saves WHERE provider_id = $1', [providerId]);
      const calendars          = await client.query('DELETE FROM calendars WHERE provider_abbr = $1', [providerAbbr]);
      const tournaments        = await client.query('DELETE FROM tournaments WHERE provider_id = $1', [providerId]);

      // Count CASCADE-bound rows BEFORE the providers DELETE so we can
      // report them in the returned counts.
      const topologies   = await client.query('SELECT COUNT(*)::int AS n FROM provider_topologies WHERE provider_id = $1', [providerId]);
      const catalogItems = await client.query('SELECT COUNT(*)::int AS n FROM provider_catalog_items WHERE provider_id = $1', [providerId]);
      const policies     = await client.query('SELECT COUNT(*)::int AS n FROM policies WHERE provider_id = $1', [providerId]);

      // Audit log row count (preserved, not deleted) — query within the
      // same transaction so the answer is consistent with the live state
      // at wipe time.
      const auditLogRows = await client.query(
        `SELECT COUNT(*)::int AS n FROM audit_log
          WHERE tournament_id IN (
            SELECT tournament_id FROM tournaments WHERE provider_id = $1
          )`,
        [providerId],
      );

      // FINALLY: the providers row itself. ON DELETE CASCADE picks up
      // provider_topologies + provider_catalog_items + policies.
      await client.query('DELETE FROM providers WHERE provider_id = $1', [providerId]);

      await client.query('COMMIT');

      return {
        tournaments: tournaments.rowCount ?? 0,
        userAssociations: userAssoc.rowCount ?? 0,
        provisionerAssociations: provisionerAssoc.rowCount ?? 0,
        tournamentAssignments: tournamentAssign.rowCount ?? 0,
        officialRecords: officialRec.rowCount ?? 0,
        sanctioningRecords: sanctioningRec.rowCount ?? 0,
        tournamentProvisioner: tournamentProv.rowCount ?? 0,
        pendingSaves: pendingSaves.rowCount ?? 0,
        calendars: calendars.rowCount ?? 0,
        topologies: topologies.rows[0]?.n ?? 0,
        catalogItems: catalogItems.rows[0]?.n ?? 0,
        policies: policies.rows[0]?.n ?? 0,
        auditLogRows: auditLogRows.rows[0]?.n ?? 0,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
