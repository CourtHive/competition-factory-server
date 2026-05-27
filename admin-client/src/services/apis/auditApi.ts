import { baseApi } from './baseApi';

export interface DeletedDrawAuditRow {
  auditId: string;
  tournamentId: string;
  userId?: string;
  userEmail?: string;
  source?: string;
  occurredAt: string;
  actionType: string;
  methods: Array<{ method: string; params?: any }>;
  status: string;
  metadata?: {
    eventId?: string;
    drawId?: string;
    drawName?: string;
    drawType?: string;
    deletedDrawSnapshot?: Record<string, any>;
    auditData?: Record<string, any>;
  };
}

export interface DeletedDrawsResponse {
  success: boolean;
  auditRows: DeletedDrawAuditRow[];
}

export interface RestoreDrawResponse {
  success?: boolean;
  error?: string;
  info?: string;
  tournamentId?: string;
  eventId?: string;
  drawId?: string;
}

/** Fetch DELETE_DRAW audit rows for a tournament (super-admin only). */
export async function getDeletedDraws(params: {
  tournamentId?: string;
  eventId?: string;
}): Promise<DeletedDrawsResponse | null> {
  const res = await baseApi.post('/audit/deleted-draws', params);
  return res?.data ?? null;
}

/** Restore a previously deleted drawDefinition from its audit snapshot. */
export async function restoreDeletedDraw(auditId: string): Promise<RestoreDrawResponse | null> {
  const res = await baseApi.post('/audit/restore-draw', { auditId });
  return res?.data ?? null;
}
