import pg from 'pg';

const { Pool } = pg;

export function createPool(): pg.Pool {
  return new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT) || 5432,
    user: process.env.PG_USER || 'courthive',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'courthive',
  });
}

export type AuditRow = {
  audit_id: string;
  tournament_id: string;
  user_id?: string;
  user_email?: string;
  source?: string;
  occurred_at: string;
  action_type: string;
  methods: Array<{ method: string; params?: any }>;
  status: string;
  metadata?: Record<string, any>;
  error_code?: string;
};

export type AuditSummary = {
  summary_id: string;
  tournament_id: string;
  report_type: string;
  condensed_at: string;
  from_date?: string;
  to_date?: string;
  data: any;
  row_count: number;
};

export async function getAuditRows(pool: pg.Pool, tournamentId: string): Promise<AuditRow[]> {
  const result = await pool.query(
    'SELECT * FROM audit_log WHERE tournament_id = $1 ORDER BY occurred_at ASC',
    [tournamentId],
  );
  return result.rows;
}

export async function upsertSummary(pool: pg.Pool, summary: AuditSummary): Promise<void> {
  await pool.query(
    `INSERT INTO audit_summary (summary_id, tournament_id, report_type, condensed_at, from_date, to_date, data, row_count)
     VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
     ON CONFLICT (summary_id) DO UPDATE SET
       condensed_at = NOW(),
       from_date = EXCLUDED.from_date,
       to_date = EXCLUDED.to_date,
       data = EXCLUDED.data,
       row_count = EXCLUDED.row_count`,
    [summary.summary_id, summary.tournament_id, summary.report_type, summary.from_date, summary.to_date, JSON.stringify(summary.data), summary.row_count],
  );
}

// --- Pending saves queries ---

export type PendingSaveRow = {
  save_id: string;
  tournament_id: string;
  user_id?: string;
  user_email?: string;
  provider_id?: string;
  status: string;
  validation_level: string;
  tournament_data: any;
  errors: string[];
  warnings: string[];
};

export async function getPendingRows(pool: pg.Pool): Promise<PendingSaveRow[]> {
  const result = await pool.query(
    `UPDATE pending_saves SET status = 'validating'
     WHERE save_id IN (SELECT save_id FROM pending_saves WHERE status = 'pending' ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
  );
  return result.rows;
}

export async function markSaveResult(
  pool: pg.Pool,
  saveId: string,
  status: 'accepted' | 'rejected',
  errors: string[],
  warnings: string[],
): Promise<void> {
  const committedClause = status === 'accepted' ? ', committed_at = NOW()' : '';
  await pool.query(
    `UPDATE pending_saves SET status = $1, errors = $2, warnings = $3, validated_at = NOW()${committedClause} WHERE save_id = $4`,
    [status, JSON.stringify(errors), JSON.stringify(warnings), saveId],
  );
}

export async function getSummary(pool: pg.Pool, tournamentId: string, reportType: string): Promise<AuditSummary | null> {
  const result = await pool.query(
    'SELECT * FROM audit_summary WHERE tournament_id = $1 AND report_type = $2',
    [tournamentId, reportType],
  );
  return result.rows[0] || null;
}
