import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

import { AUDIT_STORAGE, type IAuditStorage, type AuditRow } from 'src/storage/interfaces';
import { tools } from 'tods-competition-factory';

const DEFAULT_RETENTION_DAYS = 90;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private pruneStartupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(@Inject(AUDIT_STORAGE) private readonly auditStorage: IAuditStorage) {}

  onModuleInit() {
    const retentionDays = this.getRetentionDays();
    this.logger.log(`Audit trail active — retention: ${retentionDays} days, prune interval: daily`);

    // Run prune once on startup (deferred) then on interval
    this.pruneStartupTimer = setTimeout(() => this.pruneExpired(), 10_000);
    this.pruneStartupTimer.unref(); // don't keep the process alive for the startup prune
    this.pruneTimer = setInterval(() => this.pruneExpired(), PRUNE_INTERVAL_MS);
    this.pruneTimer.unref(); // don't keep the process alive for pruning
  }

  onModuleDestroy() {
    if (this.pruneStartupTimer) clearTimeout(this.pruneStartupTimer);
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
    metadata?: Record<string, any>;
  }): Promise<void> {
    const { tournamentIds, userId, userEmail, source, methods, status, errorCode, metadata } = params;

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
        ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
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
   * Record a provisioner deletion event. Uses the provisionerId in the
   * tournamentId column (which is just a denormalized indexed string with no
   * FK) so the row is queryable by `findByActionType('DELETE_PROVISIONER')`.
   * Cascade counts are stored in metadata so teardown is reconstructable.
   */
  async recordProvisionerDeletion(params: {
    provisionerId: string;
    provisionerName?: string;
    cascadeCounts: { apiKeys: number; providerAssociations: number; tournamentStamps: number };
    userId?: string;
    userEmail?: string;
  }): Promise<void> {
    const { provisionerId, provisionerName, cascadeCounts, userId, userEmail } = params;

    const row: AuditRow = {
      auditId: tools.UUID(),
      tournamentId: provisionerId,
      userId,
      userEmail,
      source: 'admin',
      occurredAt: new Date().toISOString(),
      actionType: 'DELETE_PROVISIONER',
      methods: [{ method: 'deleteProvisioner', params: { provisionerId } }],
      status: 'applied',
      metadata: {
        provisionerId,
        provisionerName,
        cascadeCounts,
        deletedAt: new Date().toISOString(),
      },
    };

    try {
      await this.auditStorage.append(row);
      this.logger.log(
        `Recorded deletion audit for provisioner ${provisionerId} (${provisionerName ?? 'unnamed'}) — keys=${cascadeCounts.apiKeys}, assoc=${cascadeCounts.providerAssociations}, stamps=${cascadeCounts.tournamentStamps}`,
      );
    } catch (err: any) {
      this.logger.error(`Failed to record provisioner deletion audit for ${provisionerId}: ${err.message}`);
    }
  }

  /**
   * Record one draw-deletion event per deleted drawDefinition.
   *
   * Called from the factory AUDIT topic subscription in getMutationEngine
   * whenever deleteDrawDefinitions runs. The full drawDefinition snapshot is
   * stashed in metadata.deletedDrawDetail so the deletion is recoverable
   * post-hoc. Fail-soft: errors are logged but never block the ack.
   */
  async recordDrawDeletion(params: {
    tournamentId: string;
    eventId?: string;
    drawId: string;
    drawName?: string;
    drawType?: string;
    deletedDrawSnapshot: Record<string, any>;
    auditData?: Record<string, any>;
    userId?: string;
    userEmail?: string;
    source?: string;
  }): Promise<void> {
    const {
      tournamentId,
      eventId,
      drawId,
      drawName,
      drawType,
      deletedDrawSnapshot,
      auditData,
      userId,
      userEmail,
      source,
    } = params;

    const row: AuditRow = {
      auditId: tools.UUID(),
      tournamentId,
      userId,
      userEmail,
      source: source ?? 'tmx',
      occurredAt: new Date().toISOString(),
      actionType: 'DELETE_DRAW',
      methods: [{ method: 'deleteDrawDefinitions', params: { drawIds: [drawId], eventId } }],
      status: 'applied',
      metadata: {
        eventId,
        drawId,
        drawName,
        drawType,
        deletedDrawSnapshot,
        ...(auditData ? { auditData } : {}),
      },
    };

    try {
      await this.auditStorage.append(row);
    } catch (err: any) {
      this.logger.error(`Failed to record draw deletion audit for ${tournamentId}/${drawId}: ${err.message}`);
    }
  }

  /**
   * Record a tournament save event (REST save, not executionQueue).
   */
  async recordSave(params: { tournamentId: string; userId?: string; userEmail?: string }): Promise<void> {
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

  /**
   * Return DELETE_DRAW audit rows, optionally filtered by tournamentId and/or
   * eventId. The snapshot for each row sits in metadata.deletedDrawSnapshot.
   */
  async getDeletedDraws(params?: {
    tournamentId?: string;
    eventId?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<{ success: boolean; auditRows: AuditRow[] }> {
    const rows = params?.tournamentId
      ? (await this.auditStorage.findByTournamentId(params.tournamentId, params)).filter(
          (row) => row.actionType === 'DELETE_DRAW',
        )
      : await this.auditStorage.findByActionType('DELETE_DRAW', params);

    const filtered = params?.eventId ? rows.filter((row) => row.metadata?.eventId === params.eventId) : rows;
    return { success: true, auditRows: filtered };
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
    const parsed = envVal ? Number.parseInt(envVal, 10) : Number.NaN;
    return Number.isNaN(parsed) || parsed < 1 ? DEFAULT_RETENTION_DAYS : parsed;
  }
}
