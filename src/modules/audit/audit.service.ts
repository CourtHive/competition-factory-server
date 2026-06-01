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

import { toActor } from './audit-actor';

const DEFAULT_RETENTION_DAYS = 90;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private pruneStartupTimer: ReturnType<typeof setTimeout> | null = null;

  // Per-actionType failure counter. Throttling pattern mirrors
  // PersonsClient (feedback_persons_client_hardening): first ERROR at
  // attempt 1, then powers-of-10 milestones (10, 100, 1000), then
  // every 50th thereafter. Without throttling, a schema mismatch
  // (e.g. the pre-036 audit user_id UUID type bug) hammers ERROR-level
  // log lines once per inbound API call.
  private readonly failureCounts = new Map<string, number>();

  // Per-actionType serialization for persisted-counter writes. Concurrent
  // recordFailure / recordRecovery for the same actionType used to race
  // at the DB and could produce INSERT → INSERT-on-conflict → DELETE
  // ordering that left the row gone while in-memory still tracked
  // failures — defeating migration-037's restart-survival promise. The
  // chain forces inc/clear ops to land in call order per key.
  private readonly counterDbWriteChain = new Map<string, Promise<unknown>>();
  private chainCounterWrite(actionType: string, op: () => Promise<unknown>): void {
    const prev = this.counterDbWriteChain.get(actionType) ?? Promise.resolve();
    const next = prev.then(op, op).catch(() => undefined);
    this.counterDbWriteChain.set(actionType, next);
    next.finally(() => {
      if (this.counterDbWriteChain.get(actionType) === next) {
        this.counterDbWriteChain.delete(actionType);
      }
    });
  }

  constructor(
    @Inject(AUDIT_STORAGE) private readonly auditStorage: IAuditStorage,
    @Optional() private readonly tournamentStorageService?: TournamentStorageService,
    @Optional() @Inject(TOURNAMENT_PROVISIONER_STORAGE)
    private readonly tournamentProvisionerStorage?: ITournamentProvisionerStorage,
  ) {}

  async onModuleInit() {
    const retentionDays = this.getRetentionDays();
    this.logger.log(`Audit trail active — retention: ${retentionDays} days, prune interval: daily`);

    // Hydrate the in-memory failure counter from persisted state so the
    // milestone logic continues across restarts instead of re-emitting
    // loud "(1x)" ERRORs for chronic failures on every deploy. Best
    // effort — if loadFailureCounts isn't supported by the storage
    // backing (older tests pre-037), the in-memory map just starts
    // empty as before.
    //
    // Bound the await with a 5-second ceiling so a hung Postgres at
    // boot (DB unreachable, slow connect) doesn't block the entire
    // NestJS bootstrap chain. If we hit the ceiling, prune still
    // schedules, the counter starts empty, and the next failure-side
    // upsert via chainCounterWrite will lazily re-establish the row.
    const hydrationTimeoutMs = 5_000;
    try {
      const hydrationPromise = this.auditStorage.loadFailureCounts?.() ?? Promise.resolve([]);
      const persisted = await Promise.race([
        hydrationPromise,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error(`hydration timed out after ${hydrationTimeoutMs}ms`)), hydrationTimeoutMs).unref(),
        ),
      ]);
      for (const { actionType, count } of persisted) {
        this.failureCounts.set(actionType, count);
      }
      if (persisted.length > 0) {
        const summary = persisted.map((p) => `${p.actionType}=${p.count}`).join(', ');
        this.logger.warn(`Audit failure counters hydrated from persisted state: ${summary}`);
      }
    } catch (err: any) {
      this.logger.warn(`Audit failure counter hydration failed: ${err.message}`);
    }

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

  /**
   * Increment the per-actionType failure counter and emit at the right
   * level. First failure → ERROR (the operator notices). Subsequent
   * failures throttle to DEBUG except at the 10/100/1000 + every-50th
   * milestones where they re-emit at ERROR so a long-running outage
   * stays visible without dominating the log file.
   */
  private recordFailure(actionType: string, tournamentId: string, err: Error): void {
    const count = (this.failureCounts.get(actionType) ?? 0) + 1;
    this.failureCounts.set(actionType, count);
    const isMilestone = count === 1 || count === 10 || count === 100 || count === 1000 || count % 50 === 0;
    const message = `Failed to record ${actionType} audit (${count}x) for ${tournamentId}: ${err.message}`;
    if (isMilestone) this.logger.error(message);
    else this.logger.debug(message);

    // Persist the increment so the counter survives process restarts
    // (A4). Per-actionType chained — concurrent recordFailure /
    // recordRecovery calls land in call order at the DB. If the same DB
    // outage caused the original append failure, this also fails and
    // the in-memory count continues to drive milestone logic for the
    // rest of this process lifetime.
    this.chainCounterWrite(actionType, () =>
      this.auditStorage.incrementFailureCount?.(actionType, err.message) ?? Promise.resolve(),
    );
  }

  /**
   * Called on the first successful append of an actionType after one or
   * more failures — emits an INFO-equivalent (LOG) line so the operator
   * notices recovery, and resets the counter.
   *
   * Currently invoked manually inside the append-then-catch blocks. A
   * later refactor could route every append through a single helper.
   */
  private recordRecovery(actionType: string): void {
    const previous = this.failureCounts.get(actionType);
    if (!previous) return;
    this.failureCounts.delete(actionType);
    this.logger.warn(`Audit append for ${actionType} recovered after ${previous} failure(s)`);

    // Drop the persisted counter so a future failure of the same
    // actionType starts a fresh milestone progression. Chained on the
    // same per-actionType promise as recordFailure so the DELETE can't
    // race ahead of (or interleave between) outstanding INSERT-on-
    // conflict ops for this key.
    this.chainCounterWrite(actionType, () =>
      this.auditStorage.clearFailureCount?.(actionType) ?? Promise.resolve(),
    );
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

    const actor = toActor(userId);
    for (const tournamentId of tournamentIds) {
      const row: AuditRow = {
        auditId: tools.UUID(),
        tournamentId,
        userId,
        userEmail,
        actor,
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
        this.recordRecovery('MUTATION');
      } catch (err: any) {
        this.recordFailure('MUTATION', tournamentId, err);
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
      actor: toActor({ providerId, userId }),
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
      this.recordRecovery('DELETE_TOURNAMENT');
      this.logger.log(`Recorded deletion audit for ${tournamentId} (${tournamentName})`);
    } catch (err: any) {
      this.recordFailure('DELETE_TOURNAMENT', tournamentId, err);
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
      actor: toActor(userId),
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
      this.recordRecovery('DELETE_PROVISIONER');
      this.logger.log(
        `Recorded deletion audit for provisioner ${provisionerId} (${provisionerName ?? 'unnamed'}) — keys=${cascadeCounts.apiKeys}, assoc=${cascadeCounts.providerAssociations}, stamps=${cascadeCounts.tournamentStamps}`,
      );
    } catch (err: any) {
      this.recordFailure('DELETE_PROVISIONER', provisionerId, err);
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
      actor: toActor(userId),
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
      this.recordRecovery('DELETE_DRAW');
    } catch (err: any) {
      this.recordFailure('DELETE_DRAW', `${tournamentId}/${drawId}`, err);
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
      actor: toActor(actorUserId),
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
      this.recordRecovery('CONTACT_EMAIL_CHANGED');
    } catch (err: any) {
      this.recordFailure('CONTACT_EMAIL_CHANGED', targetUserId, err);
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
      actor: toActor(targetUserId),
      source: 'verify-link',
      occurredAt: new Date().toISOString(),
      actionType: 'CONTACT_EMAIL_VERIFIED',
      methods: [{ method: 'markEmailVerified', params: { targetUserId } }],
      status: 'applied',
      metadata: { targetUserId, targetEmail, contactEmail },
    };

    try {
      await this.auditStorage.append(row);
      this.recordRecovery('CONTACT_EMAIL_VERIFIED');
    } catch (err: any) {
      this.recordFailure('CONTACT_EMAIL_VERIFIED', targetUserId, err);
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
      actor: toActor(userId),
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
      this.recordRecovery('RESTORE_DRAW');
    } catch (err: any) {
      this.recordFailure('RESTORE_DRAW', `${tournamentId}/${drawId}`, err);
    }

    return { success: true, tournamentId, eventId, drawId };
  }

  /**
   * Record a tracker-token mint. Written by TrackerTokenService after the
   * ownership gate passes and the JWT is signed. Lets ops trace which
   * provider minted what scope, when, for how long.
   */
  async recordTrackerTokenIssued(params: {
    tournamentId: string;
    providerId?: string;
    provisionerId?: string;
    audience: 'admin' | 'score';
    ttlSeconds: number;
    expiresAt: string;
    userId?: string;
  }): Promise<void> {
    const { tournamentId, providerId, provisionerId, audience, ttlSeconds, expiresAt, userId } = params;
    // Resolve the polymorphic actor — handles provisioner:<uuid>,
    // provider:<uuid>, service:<name>, bare uuid (user). Replaces
    // the pre-036 pattern of putting prefixed strings into a
    // UUID-typed user_id column, which threw `invalid input syntax`
    // every mint and spammed the logs.
    const actor = toActor({ provisionerId, providerId, userId });
    const row: AuditRow = {
      auditId: tools.UUID(),
      tournamentId,
      actor,
      source: providerId ? `provider:${providerId}` : provisionerId ? `provisioner:${provisionerId}` : 'admin',
      occurredAt: new Date().toISOString(),
      actionType: 'TRACKER_TOKEN_ISSUED',
      methods: [{ method: 'mintTrackerToken', params: { tournamentId, ttlSeconds } }],
      status: 'applied',
      metadata: { audience, ttlSeconds, expiresAt, providerId, provisionerId },
    };
    try {
      await this.auditStorage.append(row);
      this.recordRecovery('TRACKER_TOKEN_ISSUED');
    } catch (err: any) {
      this.recordFailure('TRACKER_TOKEN_ISSUED', tournamentId, err);
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
      actor: toActor(userId),
      source: 'tmx',
      occurredAt: new Date().toISOString(),
      actionType: 'SAVE',
      methods: [{ method: 'saveTournamentRecords' }],
      status: 'applied',
    };

    try {
      await this.auditStorage.append(row);
      this.recordRecovery('SAVE');
    } catch (err: any) {
      this.recordFailure('SAVE', tournamentId, err);
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
   * Get every audit row stamped by one actor — provisioner, provider,
   * user, or service. Use to bound a provisioner's blast radius
   * ("what did `provisioner:<id>` do this week") and to drive the
   * migration-036 partial index that was otherwise dead weight.
   */
  async getByActor(params: {
    actorType: 'user' | 'provisioner' | 'provider' | 'service';
    actorId: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<{ success: boolean; auditRows: AuditRow[] }> {
    const rows = await this.auditStorage.findByActor(params.actorType, params.actorId, params);
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
