import { computeFanOutTargets, isLinkGraphMutation, isScheduleAffecting, venueIdsFromMethods, venueIdsFromRecord } from './facility-schedule-broadcast.helpers';
import { buildPublicLivePayloadFromMatchUp } from 'src/modules/projectors/transforms/public-live-from-matchup.transform';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { ProjectorService } from 'src/modules/projectors/projector.service';
import { PublicGateway } from '../public/public.gateway';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { topicConstants, tools } from 'tods-competition-factory';
import type { Server, Socket } from 'socket.io';

const TOURNAMENT_ROOM_PREFIX = 'tournament:';

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
  private tmxServer?: Server;
  // Debounce state keyed by source tournamentId. In-memory: a pending fan-out lost on restart is
  // negligible — the coordinating client's focus/reconnect re-fetch + long safety poll backstop it.
  private readonly pendingFacilityFanOut = new Map<string, PendingFacilityFanOut>();
  // Feature-flagged, default OFF. Read once at construction so tests can toggle it deterministically.
  private readonly facilityBroadcastEnabled = process.env.ENABLE_FACILITY_SCHEDULE_BROADCAST === 'true';

  constructor(
    private readonly publicGateway: PublicGateway,
    @Optional() private readonly projectorService?: ProjectorService,
    @Optional() private readonly tournamentStorageService?: TournamentStorageService,
  ) {}

  /**
   * Called by TmxGateway after the Socket.IO server initializes
   * so the broadcast service can emit to /tmx namespace rooms.
   */
  setTmxServer(server: Server): void {
    this.tmxServer = server;
  }

  /**
   * Broadcast an approved executionQueue to TMX clients in the affected
   * tournament room(s).
   *
   * @param payload   The mutation payload (methods, tournamentIds, userId, timestamp)
   * @param sender    Optional socket to exclude from the broadcast (Socket.IO origin path)
   */
  async broadcastMutation(payload: any, sender?: Socket): Promise<void> {
    if (!this.tmxServer) {
      this.logger.warn('[broadcast] tmxServer not available — skipping mutation broadcast');
      return;
    }

    const tournamentIds: string[] = payload?.tournamentIds || (payload?.tournamentId ? [payload.tournamentId] : []);
    const methods = payload?.methods;
    if (!methods?.length || !tournamentIds.length) {
      this.logger.warn(`[broadcast] skipped — methods: ${methods?.length}, tournamentIds: ${tournamentIds.length}`);
      return;
    }

    const broadcast = {
      methods,
      tournamentIds,
      userId: payload?.userId,
      timestamp: payload?.timestamp,
    };

    for (const tournamentId of tournamentIds) {
      const room = TOURNAMENT_ROOM_PREFIX + tournamentId;
      const roomMembers = await this.tmxServer.in(room).fetchSockets();
      const memberIds = roomMembers?.map((s) => s.id) ?? [];
      const senderInfo = sender ? ` — sender: ${sender.id}` : ' — no sender (REST)';
      this.logger.log(`[broadcast] room ${room} has ${memberIds.length} member(s): [${memberIds.join(', ')}]${senderInfo}`);

      if (sender) {
        // Socket.IO path: exclude the sender (they already got an ack)
        sender.to(room).emit('tournamentMutation', broadcast);
      } else {
        // REST path: notify all clients in the room
        this.tmxServer.to(room).emit('tournamentMutation', broadcast);
      }
    }

    const methodNames = tools.unique(methods.map((m) => m.method) ?? []).join('|');
    const exclusionNote = sender ? ` (excluding sender ${sender.id})` : ' (all clients)';
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
    if (!this.facilityBroadcastEnabled || !this.tmxServer) return;

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
    if (!pending || !this.tmxServer) return;

    Promise.resolve(this.tournamentStorageService?.fetchTournamentRecords({ tournamentId: sourceId }))
      .then((result: any) => this.emitFacilityScheduleChanged(sourceId, pending, result?.tournamentRecords?.[sourceId]))
      .catch((err) =>
        this.logger.warn(`[facility-broadcast] fan-out failed for ${sourceId}: ${(err as Error)?.message ?? err}`),
      );
  }

  private emitFacilityScheduleChanged(sourceId: string, pending: PendingFacilityFanOut, record: any): void {
    if (!this.tmxServer) return;
    const targets = computeFanOutTargets(record, pending, sourceId);
    if (!targets.length) return;

    const venueIds = pending.venueIds.size ? [...pending.venueIds] : venueIdsFromRecord(record);
    const event = { venueIds, changedAt: Date.now() };
    for (const target of targets) {
      this.tmxServer.to(TOURNAMENT_ROOM_PREFIX + target).emit('facilityScheduleChanged', event);
    }
    this.logger.debug(
      `[facility-broadcast] facilityScheduleChanged from ${sourceId} → ${targets.length} room(s) [${targets.join(', ')}], venues [${venueIds.join(', ')}]`,
    );
  }

  /**
   * Sanitize factory notices and broadcast to public viewers via the /public namespace.
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
      const matchUpNotices = notices.filter((n) => n.topic === topicConstants.MODIFY_MATCHUP);
      const positionNotices = notices.filter((n) => n.topic === topicConstants.MODIFY_POSITION_ASSIGNMENTS);

      if (matchUpNotices.length) {
        this.publicGateway.broadcastPublicUpdate(tournamentId, {
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
            this.publicGateway.broadcastLiveScore(tournamentId, payload);
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
        this.publicGateway.broadcastPublicUpdate(tournamentId, {
          type: 'publishChange',
          tournamentId,
          action: notice.topic,
          eventId: notice.eventId,
        });
      }
    }
  }
}
