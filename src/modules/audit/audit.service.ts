import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

import { AUDIT_STORAGE, type IAuditStorage, type AuditRow } from 'src/storage/interfaces';
import { tools } from 'tods-competition-factory';

const DEFAULT_RETENTION_DAYS = 90;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(AUDIT_STORAGE) private readonly auditStorage: IAuditStorage,
  ) {}

  onModuleInit() {
    const retentionDays = this.getRetentionDays();
    this.logger.log(`Audit trail active — retention: ${retentionDays} days, prune interval: daily`);

    // Run prune once on startup (deferred) then on interval
    setTimeout(() => this.pruneExpired(), 10_000);
    this.pruneTimer = setInterval(() => this.pruneExpired(), PRUNE_INTERVAL_MS);
    this.pruneTimer.unref(); // don't keep the process alive for pruning
  }

  onModuleDestroy() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }

  // ── Ingestion ──

  /**
   * Record a mutation audit event. Called from executionQueue after the
   * factory mutation succeeds. Fail-soft: logs errors but never throws.
   */
  async recordMutation(params: {
    tournamentIds: string[];
    userId?: string;
    userEmail?: string;
    source?: string;
    methods: Array<{ method: string; params?: any }>;
    status: 'applied' | 'rejected' | 'partial';
    errorCode?: string;
  }): Promise<void> {
    const { tournamentIds, userId, userEmail, source, methods, status, errorCode } = params;

    for (const tournamentId of tournamentIds) {
      const row: AuditRow = {
        auditId: tools.UUID(),
        tournamentId,
        userId,
        userEmail,
        source: source ?? 'tmx',
        occurredAt: new Date().toISOString(),
        actionType: 'MUTATION',
        methods,
        status,
        errorCode,
      };

      try {
        await this.auditStorage.append(row);
      } catch (err: any) {
        this.logger.error(`Failed to record audit for ${tournamentId}: ${err.message}`);
      }
    }
  }

  /**
   * Record a tournament deletion event. Called from tournament-storage.service
   * before the record is removed. Captures tournament metadata so the
   * deletion is traceable even after the record is gone.
   */
  async recordDeletion(params: {
    tournamentId: string;
    tournamentName?: string;
    providerId?: string;
    userId?: string;
    userEmail?: string;
  }): Promise<void> {
    const { tournamentId, tournamentName, providerId, userId, userEmail } = params;

    const row: AuditRow = {
      auditId: tools.UUID(),
      tournamentId,
      userId,
      userEmail,
      source: 'tmx',
      occurredAt: new Date().toISOString(),
      actionType: 'DELETE_TOURNAMENT',
      methods: [{ method: 'removeTournamentRecords' }],
      status: 'applied',
      metadata: {
        tournamentName,
        providerId,
        deletedAt: new Date().toISOString(),
      },
    };

    try {
      await this.auditStorage.append(row);
      this.logger.log(`Recorded deletion audit for ${tournamentId} (${tournamentName})`);
    } catch (err: any) {
      this.logger.error(`Failed to record deletion audit for ${tournamentId}: ${err.message}`);
    }
  }

  /**
   * Record a tournament save event (REST save, not executionQueue).
   */
  async recordSave(params: {
    tournamentId: string;
    userId?: string;
    userEmail?: string;
  }): Promise<void> {
    const { tournamentId, userId, userEmail } = params;

    const row: AuditRow = {
      auditId: tools.UUID(),
      tournamentId,
      userId,
      userEmail,
      source: 'tmx',
      occurredAt: new Date().toISOString(),
      actionType: 'SAVE',
      methods: [{ method: 'saveTournamentRecords' }],
      status: 'applied',
    };

    try {
      await this.auditStorage.append(row);
    } catch (err: any) {
      this.logger.error(`Failed to record save audit for ${tournamentId}: ${err.message}`);
    }
  }

  // ── Query ──

  async getAuditTrail(params: {
    tournamentId: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<{ success: boolean; auditRows: AuditRow[] }> {
    const rows = await this.auditStorage.findByTournamentId(params.tournamentId, params);
    return { success: true, auditRows: rows };
  }

  async getDeletedTournaments(params?: {
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<{ success: boolean; auditRows: AuditRow[] }> {
    const rows = await this.auditStorage.findByActionType('DELETE_TOURNAMENT', params);
    return { success: true, auditRows: rows };
  }

  // ── Prune ──

  private async pruneExpired(): Promise<void> {
    const retentionDays = this.getRetentionDays();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    try {
      const count = await this.auditStorage.prune(cutoff);
      if (count > 0) {
        this.logger.log(`Pruned ${count} audit row(s) older than ${retentionDays} days`);
      }
    } catch (err: any) {
      this.logger.error(`Audit prune failed: ${err.message}`);
    }
  }

  private getRetentionDays(): number {
    const envVal = process.env.AUDIT_RETENTION_DAYS;
    const parsed = envVal ? parseInt(envVal, 10) : NaN;
    return isNaN(parsed) || parsed < 1 ? DEFAULT_RETENTION_DAYS : parsed;
  }
}
