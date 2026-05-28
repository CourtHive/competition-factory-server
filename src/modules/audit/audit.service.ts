import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';

import { executionQueue } from '../factory/functions/private/executionQueue';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import {
  AUDIT_STORAGE,
  type IAuditStorage,
  type AuditRow,
  TOURNAMENT_PROVISIONER_STORAGE,
  type ITournamentProvisionerStorage,
} from 'src/storage/interfaces';
import { tools } from 'tods-competition-factory';

const DEFAULT_RETENTION_DAYS = 90;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private pruneStartupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @Inject(AUDIT_STORAGE) private readonly auditStorage: IAuditStorage,
    @Optional() private readonly tournamentStorageService?: TournamentStorageService,
    @Optional() @Inject(TOURNAMENT_PROVISIONER_STORAGE)
    private readonly tournamentProvisionerStorage?: ITournamentProvisionerStorage,
  ) {}

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
   * Record a contact-email change. Used by the admin Edit User modal
   * (via authService.modifyUser) and the self-service
   * /account/contact-email/set flow. Uses the target's userId in the
   * tournamentId slot — same denormalized indexed string pattern as
   * recordProvisionerDeletion. Fail-soft.
   */
  async recordContactEmailChanged(params: {
    targetUserId: string;
    targetEmail?: string;
    actorUserId?: string;
    actorEmail?: string;
    oldContactEmail?: string | null;
    newContactEmail: string;
    source?: string;
  }): Promise<void> {
    const { targetUserId, targetEmail, actorUserId, actorEmail, oldContactEmail, newContactEmail, source } = params;

    const row: AuditRow = {
      auditId: tools.UUID(),
      tournamentId: targetUserId,
      userId: actorUserId,
      userEmail: actorEmail,
      source: source ?? 'admin',
      occurredAt: new Date().toISOString(),
      actionType: 'CONTACT_EMAIL_CHANGED',
      methods: [{ method: 'setContactEmail', params: { targetUserId } }],
      status: 'applied',
      metadata: {
        targetUserId,
        targetEmail,
        oldContactEmail: oldContactEmail ?? null,
        newContactEmail,
      },
    };

    try {
      await this.auditStorage.append(row);
    } catch (err: any) {
      this.logger.error(`Failed to record contact-email change audit for ${targetUserId}: ${err.message}`);
    }
  }

  /**
   * Record a successful contact-email verification (user clicked the
   * verification link). Actor is the user themselves — the verify
   * endpoint is public and authenticated only by the token. Fail-soft.
   */
  async recordContactEmailVerified(params: {
    targetUserId: string;
    targetEmail?: string;
    contactEmail: string;
  }): Promise<void> {
    const { targetUserId, targetEmail, contactEmail } = params;

    const row: AuditRow = {
      auditId: tools.UUID(),
      tournamentId: targetUserId,
      userId: targetUserId,
      userEmail: targetEmail,
      source: 'verify-link',
      occurredAt: new Date().toISOString(),
      actionType: 'CONTACT_EMAIL_VERIFIED',
      methods: [{ method: 'markEmailVerified', params: { targetUserId } }],
      status: 'applied',
      metadata: { targetUserId, targetEmail, contactEmail },
    };

    try {
      await this.auditStorage.append(row);
    } catch (err: any) {
      this.logger.error(`Failed to record contact-email verified audit for ${targetUserId}: ${err.message}`);
    }
  }

  /**
   * Restore a previously deleted drawDefinition from its audit-trail snapshot.
   *
   * Idempotency is enforced at two layers:
   *  1. AuditService refuses if a RESTORE_DRAW row already references this auditId
   *  2. Factory's `addDrawDefinition` returns DRAW_ID_EXISTS if the draw is back
   *
   * On success a RESTORE_DRAW row is appended so subsequent calls short-circuit.
   */
  async restoreDraw(params: {
    auditId: string;
    userId?: string;
    userEmail?: string;
  }): Promise<{
    success?: boolean;
    error?: string;
    info?: string;
    tournamentId?: string;
    eventId?: string;
    drawId?: string;
  }> {
    const { auditId, userId, userEmail } = params;

    if (!auditId) return { error: 'MISSING_AUDIT_ID' };
    if (!this.tournamentStorageService) return { error: 'STORAGE_NOT_CONFIGURED' };

    const row = await this.auditStorage.findById(auditId);
    if (!row) return { error: 'AUDIT_ROW_NOT_FOUND' };
    if (row.actionType !== 'DELETE_DRAW') return { error: 'INVALID_AUDIT_TYPE', info: `expected DELETE_DRAW, got ${row.actionType}` };

    const snapshot = row.metadata?.deletedDrawSnapshot;
    const eventId = row.metadata?.eventId;
    const drawId = row.metadata?.drawId ?? snapshot?.drawId;
    const tournamentId = row.tournamentId;

    if (!snapshot) return { error: 'MISSING_SNAPSHOT' };
    if (!eventId) return { error: 'MISSING_EVENT_ID' };

    // Idempotency: refuse if a prior RESTORE_DRAW row references this auditId
    const priorRestores = await this.auditStorage.findByTournamentId(tournamentId, { limit: 500 });
    const alreadyRestored = priorRestores.some(
      (r) => r.actionType === 'RESTORE_DRAW' && r.metadata?.restoredFromAuditId === auditId,
    );
    if (alreadyRestored) {
      return { error: 'ALREADY_RESTORED', tournamentId, eventId, drawId };
    }

    const result: any = await executionQueue(
      {
        tournamentIds: [tournamentId],
        methods: [{ method: 'addDrawDefinition', params: { eventId, drawDefinition: snapshot } }],
        userId,
        userEmail,
        source: 'audit-restore',
      },
      undefined,
      this.tournamentStorageService,
      this,
      this.tournamentProvisionerStorage,
    );

    if (result?.error) {
      return { error: String(result.error), info: result.info, tournamentId, eventId, drawId };
    }

    const restoreRow: AuditRow = {
      auditId: tools.UUID(),
      tournamentId,
      userId,
      userEmail,
      source: 'audit-restore',
      occurredAt: new Date().toISOString(),
      actionType: 'RESTORE_DRAW',
      methods: [{ method: 'addDrawDefinition', params: { eventId, drawId } }],
      status: 'applied',
      metadata: {
        restoredFromAuditId: auditId,
        eventId,
        drawId,
        drawName: row.metadata?.drawName,
        drawType: row.metadata?.drawType,
      },
    };

    try {
      await this.auditStorage.append(restoreRow);
    } catch (err: any) {
      this.logger.error(`Failed to record draw restore audit for ${tournamentId}/${drawId}: ${err.message}`);
    }

    return { success: true, tournamentId, eventId, drawId };
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
