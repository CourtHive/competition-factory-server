import { buildPublicLivePayloadFromMatchUp } from 'src/modules/projectors/transforms/public-live-from-matchup.transform';
import { PublicGateway } from '../public/public.gateway';
import { Injectable, Logger } from '@nestjs/common';
import { topicConstants, tools } from 'tods-competition-factory';
import type { Server, Socket } from 'socket.io';

const TOURNAMENT_ROOM_PREFIX = 'tournament:';

@Injectable()
export class TournamentBroadcastService {
  private readonly logger = new Logger(TournamentBroadcastService.name);
  private tmxServer?: Server;

  constructor(private readonly publicGateway: PublicGateway) {}

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
  }

  /**
   * Broadcast a bolt-history document update to TMX clients in the affected tournament room.
   * Used by BoltHistoryService after a successful upsert so live scoreboards refresh.
   */
  broadcastBoltHistory(tournamentId: string, document: any): void {
    if (!this.tmxServer) {
      this.logger.warn('[broadcast] tmxServer not available — skipping boltHistoryUpdated broadcast');
      return;
    }
    if (!tournamentId) {
      this.logger.warn('[broadcast] boltHistoryUpdated skipped — missing tournamentId');
      return;
    }
    const room = TOURNAMENT_ROOM_PREFIX + tournamentId;
    this.tmxServer.to(room).emit('boltHistoryUpdated', { tournamentId, document });
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
