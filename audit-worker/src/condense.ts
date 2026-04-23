import { condenseSchedulingChurn } from './condensers/schedulingChurn.js';
import { condensePositionChanges } from './condensers/positionChanges.js';
import { condenseDrawRevisions } from './condensers/drawRevisions.js';
import { condenseMutationLog } from './condensers/mutationLog.js';
import { getAuditRows, upsertSummary } from './db.js';

import type pg from 'pg';

const condenserMap: Record<string, (rows: any[]) => { columns: any[]; rows: any[] }> = {
  'audit.mutationLog': condenseMutationLog,
  'audit.drawRevisions': condenseDrawRevisions,
  'audit.schedulingChurn': condenseSchedulingChurn,
  'audit.positionChanges': condensePositionChanges,
};

export const REPORT_TYPES = Object.keys(condenserMap);

export async function condenseAll(pool: pg.Pool, tournamentId: string): Promise<Record<string, any>> {
  const rows = await getAuditRows(pool, tournamentId);
  const results: Record<string, any> = {};

  for (const [reportType, condenser] of Object.entries(condenserMap)) {
    const result = condenser(rows);

    await upsertSummary(pool, {
      summary_id: `${tournamentId}:${reportType}`,
      tournament_id: tournamentId,
      report_type: reportType,
      condensed_at: new Date().toISOString(),
      from_date: rows[0]?.occurred_at,
      to_date: rows[rows.length - 1]?.occurred_at,
      data: result,
      row_count: result.rows.length,
    });

    results[reportType] = result;
  }

  return results;
}

export async function condenseOne(pool: pg.Pool, tournamentId: string, reportType: string): Promise<any> {
  const condenser = condenserMap[reportType];
  if (!condenser) return { error: `Unknown report type: ${reportType}` };

  const rows = await getAuditRows(pool, tournamentId);
  const result = condenser(rows);

  await upsertSummary(pool, {
    summary_id: `${tournamentId}:${reportType}`,
    tournament_id: tournamentId,
    report_type: reportType,
    condensed_at: new Date().toISOString(),
    from_date: rows[0]?.occurred_at,
    to_date: rows[rows.length - 1]?.occurred_at,
    data: result,
    row_count: result.rows.length,
  });

  return result;
}
