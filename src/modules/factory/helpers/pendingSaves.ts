import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

export interface PendingSave {
  saveId: string;
  tournamentId: string;
  status: 'pending' | 'validating' | 'accepted' | 'rejected';
  errors: string[];
  warnings: string[];
  validatedAt?: string;
  committedAt?: string;
  createdAt: string;
}

export async function insertPendingSave(
  pool: Pool,
  params: {
    tournamentId: string;
    tournamentData: any;
    userId?: string;
    userEmail?: string;
    providerId?: string;
    validationLevel?: string;
  },
): Promise<string> {
  const saveId = randomUUID();
  await pool.query(
    `INSERT INTO pending_saves (save_id, tournament_id, user_id, user_email, provider_id, validation_level, tournament_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [saveId, params.tournamentId, params.userId, params.userEmail, params.providerId, params.validationLevel || 'L2', JSON.stringify(params.tournamentData)],
  );
  return saveId;
}

export async function getPendingSaveStatus(pool: Pool, saveId: string): Promise<PendingSave | null> {
  const result = await pool.query(
    'SELECT save_id, tournament_id, status, errors, warnings, validated_at, committed_at, created_at FROM pending_saves WHERE save_id = $1',
    [saveId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    saveId: row.save_id,
    tournamentId: row.tournament_id,
    status: row.status,
    errors: row.errors || [],
    warnings: row.warnings || [],
    validatedAt: row.validated_at,
    committedAt: row.committed_at,
    createdAt: row.created_at,
  };
}

export async function getPendingSaveData(pool: Pool, saveId: string): Promise<any> {
  const result = await pool.query('SELECT tournament_data FROM pending_saves WHERE save_id = $1', [saveId]);
  return result.rows[0]?.tournament_data;
}

export async function updatePendingSaveStatus(
  pool: Pool,
  saveId: string,
  status: 'accepted' | 'rejected',
  fields?: { errors?: string[]; warnings?: string[] },
): Promise<void> {
  const committedClause = status === 'accepted' ? ', committed_at = NOW()' : '';
  await pool.query(
    `UPDATE pending_saves SET status = $1, errors = $2, warnings = $3, validated_at = NOW()${committedClause} WHERE save_id = $4`,
    [status, JSON.stringify(fields?.errors || []), JSON.stringify(fields?.warnings || []), saveId],
  );
}
