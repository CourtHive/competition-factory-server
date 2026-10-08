import { computeFanOutTargets, isLinkGraphMutation, isScheduleAffecting, venueIdsFromMethods, venueIdsFromRecord } from './facility-schedule-broadcast.helpers';
import { buildPublicLivePayloadFromMatchUp } from 'src/modules/projectors/transforms/public-live-from-matchup.transform';
import { REALTIME_PRESENCE, REALTIME_PUBLISHER } from '../realtime/realtime.types';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { publicTournamentChannel, tournamentChannel } from '../realtime/channels';
import { ProjectorService } from 'src/modules/projectors/projector.service';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { topicConstants, tools } from 'tods-competition-factory';

import type { RealtimeChannel, RealtimePresence, RealtimePublisher } from '../realtime/realtime.types';

// Collapse a burst (e.g. a bulk schedule = N addMatchUpScheduleItems) into one event per source.
const FACILITY_FANOUT_DEBOUNCE_MS = 500;

interface PendingFacilityFanOut {
  timer: ReturnType<typeof setTimeout> | null;
  venueIds: Set<string>;
  linkGraph: boolean;
  groupIds: Set<string>;
}

@Injectable()
export class TournamentBroadcastService {
  private readonly logger = new Logger(TournamentBroadcastService.name);
  // Debounce state keyed by source tournamentId. In-memory: a pending fan-out lost on restart is
  // negligible — the coordinating client's focus/reconnect re-fetch + long safety poll backstop it.
  private readonly pendingFacilityFanOut = new Map<string, PendingFacilityFanOut>();
  // Feature-flagged, default OFF. Read once at construction so tests can toggle it deterministically.
  private readonly facilityBroadcastEnabled = process.env.ENABLE_FACILITY_SCHEDULE_BROADCAST === 'true';

  constructor(
    @Inject(REALTIME_PUBLISHER) private readonly publisher: RealtimePublisher,
    @Inject(REALTIME_PRESENCE) private readonly presence: RealtimePresence,
    @Optional() private readonly projectorService?: ProjectorService,
    @Optional() private readonly tournamentStorageService?: TournamentStorageService,
  ) {}

  /**
   * Broadcast an approved executionQueue to TMX clients in the affected
   * tournament room(s).
   *
   * @param payload  The mutation payload (methods, tournamentIds, userId, timestamp, originClientId)
   * @param options  `excludeConnectionId`: the originating connection, which already has its ack.
   *                 Absent on the REST path, where every client in the room is notified.
   */
  /**
   * `serverUpdatedAt` is when the mutated rows were written; `previousServerUpdatedAt`, when they had
   * been written before. A client current at the previous value that applies the broadcast is current
   * at the new one; a client that missed something earlier stays behind, and the staleness probe, which
   * reports the same column, says so (P49).
   */
  async broadcastMutation(
    payload: any,
    options?: {
      excludeConnectionId?: string;
      serverUpdatedAt?: Record<string, string>;
      previousServerUpdatedAt?: Record<string, string>;
    },
  ): Promise<void> {
    const tournamentIds: string[] = payload?.tournamentIds || (payload?.tournamentId ? [payload.tournamentId] : []);
    const methods = payload?.methods;
    if (!methods?.length || !tournamentIds.length) {
      this.logger.warn(`[broadcast] skipped — methods: ${methods?.length}, tournamentIds: ${tournamentIds.length}`);
      return;
    }

    // `originClientId` lets a client recognise its own mutation on a transport that cannot exclude
    // the sender server-side. Socket.IO still excludes it, so today the field is only carried.
    const broadcast = {
      methods,
      tournamentIds,
      userId: payload?.userId,
      timestamp: payload?.timestamp,
      ...(payload?.originClientId && { originClientId: payload.originClientId }),
      ...(options?.serverUpdatedAt && {
        serverUpdatedAt: options.serverUpdatedAt,
        previousServerUpdatedAt: options.previousServerUpdatedAt,
      }),
    };

    const excludeConnectionId = options?.excludeConnectionId;
    for (const tournamentId of tournamentIds) {
      const channel = tournamentChannel(tournamentId);
      const memberIds = (await this.presence.members(channel)).map((m) => m.connectionId);
      const senderInfo = excludeConnectionId ? ` — sender: ${excludeConnectionId}` : ' — no sender (REST)';
      this.logger.log(
        `[broadcast] room ${channel.room} has ${memberIds.length} member(s): [${memberIds.join(', ')}]${senderInfo}`,
      );
      this.publisher.publish(channel, 'tournamentMutation', broadcast, { excludeConnectionId });
    }

    const methodNames = tools.unique(methods.map((m) => m.method) ?? []).join('|');
    const exclusionNote = excludeConnectionId ? ` (excluding sender ${excludeConnectionId})` : ' (all clients)';
    this.logger.log(
      `[broadcast] sent ${methods.length} mutation(s) [${methodNames}] to rooms: ${tournamentIds.join(', ')}${exclusionNote}`,
    );

    // Fire-and-forget: when the mutation moved courts (or changed the link graph), notify the source
    // tournaments' linked peers so their coordinating clients re-fetch reserved cells. Never awaited —
    // must not affect the mutation path. No-op unless ENABLE_FACILITY_SCHEDULE_BROADCAST is on.
    this.scheduleFacilityScheduleFanOut(payload);
  }

  /**
   * Debounce a facility-schedule-changed fan-out per source tournament. Accumulates the burst's touched
   * venues (and, for a link-graph mutation, the batch's other tournamentIds) then arms a single flush.
   * Cheap + synchronous — the storage read + emit happen later, off the mutation path.
   */
  private scheduleFacilityScheduleFanOut(payload: any): void {
    if (!this.facilityBroadcastEnabled) return;

    const methods = payload?.methods ?? [];
    const methodNames = methods.map((m: any) => m?.method).filter(Boolean);
    if (!isScheduleAffecting(methodNames)) return;

    const sourceIds: string[] = payload?.tournamentIds || (payload?.tournamentId ? [payload.tournamentId] : []);
    if (!sourceIds.length) return;

    const linkGraph = isLinkGraphMutation(methodNames);
    const venueIds = venueIdsFromMethods(methods);

    for (const sourceId of sourceIds) {
      if (!sourceId) continue;
      let pending = this.pendingFacilityFanOut.get(sourceId);
      if (!pending) {
        pending = { timer: null, venueIds: new Set(), linkGraph: false, groupIds: new Set() };
        this.pendingFacilityFanOut.set(sourceId, pending);
      }
      for (const venueId of venueIds) pending.venueIds.add(venueId);
      if (linkGraph) {
        pending.linkGraph = true;
        for (const id of sourceIds) if (id && id !== sourceId) pending.groupIds.add(id);
      }
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = setTimeout(() => this.flushFacilityScheduleFanOut(sourceId), FACILITY_FANOUT_DEBOUNCE_MS);
    }
  }

  /**
   * Emit the opaque `facilityScheduleChanged` to each linked peer's room. Reads the source's stored
   * links (the coordination grant is server-authoritative), computes venue scope, and emits a re-fetch
   * trigger carrying NO participant/matchUp detail. Self-contained error handling — never throws.
   */
  private flushFacilityScheduleFanOut(sourceId: string): void {
    const pending = this.pendingFacilityFanOut.get(sourceId);
    this.pendingFacilityFanOut.delete(sourceId);
    if (!pending) return;

    Promise.resolve(this.tournamentStorageService?.fetchTournamentRecords({ tournamentId: sourceId }))
      .then((result: any) => this.emitFacilityScheduleChanged(sourceId, pending, result?.tournamentRecords?.[sourceId]))
      .catch((err) =>
        this.logger.warn(`[facility-broadcast] fan-out failed for ${sourceId}: ${(err as Error)?.message ?? err}`),
      );
  }

  private emitFacilityScheduleChanged(sourceId: string, pending: PendingFacilityFanOut, record: any): void {
    const targets = computeFanOutTargets(record, pending, sourceId);
    if (!targets.length) return;

    const venueIds = pending.venueIds.size ? [...pending.venueIds] : venueIdsFromRecord(record);
    const event = { venueIds, changedAt: Date.now() };
    for (const target of targets) {
      this.publisher.publish(tournamentChannel(target), 'facilityScheduleChanged', event);
    }
    this.logger.debug(
      `[facility-broadcast] facilityScheduleChanged from ${sourceId} → ${targets.length} room(s) [${targets.join(', ')}], venues [${venueIds.join(', ')}]`,
    );
  }

  /**
   * Sanitize factory notices and broadcast them to each tournament's public channel.
   */
  broadcastPublicNotices(payload: any, publicNotices?: any[]): void {
    if (!publicNotices?.length) return;

    const tournamentIds: string[] = payload?.tournamentIds || (payload?.tournamentId ? [payload.tournamentId] : []);

    // Group notices by tournamentId
    const noticesByTournament = new Map<string, any[]>();
    for (const notice of publicNotices) {
      const tid = notice.tournamentId || tournamentIds[0];
      if (!tid) continue;
      if (!noticesByTournament.has(tid)) noticesByTournament.set(tid, []);
      noticesByTournament.get(tid)!.push(notice);
    }

    for (const [tournamentId, notices] of noticesByTournament) {
      const publicChannel = publicTournamentChannel(tournamentId);
      const matchUpNotices = notices.filter((n) => n.topic === topicConstants.MODIFY_MATCHUP);
      const positionNotices = notices.filter((n) => n.topic === topicConstants.MODIFY_POSITION_ASSIGNMENTS);

      if (matchUpNotices.length) {
        this.publishPublicUpdate(publicChannel, {
          type: 'matchUpUpdate',
          tournamentId,
          matchUps: matchUpNotices.map((n) => n.matchUp),
          positionAssignments: positionNotices.map((n) => ({
            assignments: n.positionAssignments,
            structureId: n.structureId,
            drawId: n.drawId,
          })),
        });

        // Phase 1.5: also emit a compact `liveScore` per matchUp so
        // courthive-public's existing liveScore handler picks them up
        // for non-INTENNSE formats. The bolt-history pipeline already
        // emits liveScore for INTENNSE matchUps via the projector
        // module's public-live consumer. This is the parallel path for
        // every other format the factory engine touches.
        for (const notice of matchUpNotices) {
          const payload = buildPublicLivePayloadFromMatchUp(notice.matchUp, tournamentId);
          if (payload) {
            this.publisher.publish(publicChannel, 'liveScore', payload);
          }
        }

        // Phase 3 slice 6 — crowd writes. Notify score-relay so it can
        // cancel any active crowd-scoring sessions for finalized matchUps.
        // The projector filters out non-finalizing notices internally.
        // Fire-and-forget — never blocks the mutation, never throws.
        try {
          this.projectorService?.projectMatchUpFinalized(matchUpNotices);
        } catch (err) {
          this.logger.warn(`projectMatchUpFinalized threw synchronously: ${(err as Error)?.message ?? err}`);
        }
      }

      const publishNotices = notices.filter(
        (n) => n.topic !== topicConstants.MODIFY_MATCHUP && n.topic !== topicConstants.MODIFY_POSITION_ASSIGNMENTS,
      );
      for (const notice of publishNotices) {
        this.publishPublicUpdate(publicChannel, {
          type: 'publishChange',
          tournamentId,
          action: notice.topic,
          eventId: notice.eventId,
        });
      }
    }
  }

  private publishPublicUpdate(channel: RealtimeChannel, payload: { type: string } & Record<string, any>): void {
    this.publisher.publish(channel, 'publicUpdate', payload);
    this.logger.log(`[broadcast] publicUpdate to ${channel.room} — type: ${payload.type}`);
  }
}
