import { PUBLIC_TOURNAMENT_ROOM_PREFIX, publicTournamentChannel } from '../realtime/channels';
import { Logger, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SocketIoRealtimeAdapter } from '../realtime/socket-io-realtime.adapter';
import { resolveCorsOrigins } from 'src/common/cors';
import { Server, Socket } from 'socket.io';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';

@Injectable()
@WebSocketGateway({
  // Public fan-facing broadcast (already-published, non-sensitive data). Kept
  // open by default because fan embeds live on arbitrary provider domains;
  // lock it separately via CFS_PUBLIC_CORS_ORIGINS only when that's known.
  cors: { origin: resolveCorsOrigins(process.env.CFS_PUBLIC_CORS_ORIGINS) },
  namespace: 'public',
})
export class PublicGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PublicGateway.name);
  private readonly metricsEnabled = process.env.PUBLIC_METRICS_LOG === 'true';
  private readonly metricsIntervalMs = Number(process.env.PUBLIC_METRICS_INTERVAL) || 60_000;
  private metricsTimer?: ReturnType<typeof setInterval>;

  @WebSocketServer()
  server?: Server;

  constructor(private readonly realtime: SocketIoRealtimeAdapter) {}

  /** Publishing to `public:tournament:*` goes through the realtime port, which needs this namespace. */
  afterInit(server: Server): void {
    this.realtime.bind('public', server);
  }

  onModuleInit(): void {
    if (!this.metricsEnabled) return;

    this.logger.log(`[metrics] Public metrics logging enabled (interval: ${this.metricsIntervalMs}ms)`);
    this.metricsTimer = setInterval(() => this.logMetricsSummary(), this.metricsIntervalMs);
    this.metricsTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = undefined;
    }
  }

  handleConnection(client: Socket): void {
    if (this.metricsEnabled) {
      const ip = client.handshake.address;
      const userAgent = client.handshake.headers['user-agent'] || 'unknown';
      const origin = client.handshake.headers.origin || 'unknown';
      this.logger.log(`[metrics:connect] id=${client.id} ip=${ip} origin=${origin} ua=${userAgent}`);
    } else {
      this.logger.log(`[connect] Public client ${client.id} connected`);
    }
  }

  handleDisconnect(client: Socket): void {
    if (this.metricsEnabled) {
      this.logger.log(`[metrics:disconnect] id=${client.id}`);
    } else {
      this.logger.log(`[disconnect] Public client ${client.id} disconnected`);
    }
  }

  @SubscribeMessage('joinTournament')
  async joinTournament(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<void> {
    const tournamentId = data?.tournamentId;
    if (!tournamentId || typeof tournamentId !== 'string') {
      this.logger.warn(`[room] joinTournament rejected — invalid tournamentId: ${JSON.stringify(data)}`);
      return;
    }

    const { room } = publicTournamentChannel(tournamentId);
    await client.join(room);
    const roomMembers = await this.server?.in(room).fetchSockets();
    const count = roomMembers?.length ?? '?';

    if (this.metricsEnabled) {
      this.logger.log(`[metrics:join] id=${client.id} tournament=${tournamentId} roomSize=${count}`);
    } else {
      this.logger.log(`[room] Public client ${client.id} joined ${room} — ${count} member(s)`);
    }
  }

  @SubscribeMessage('leaveTournament')
  async leaveTournament(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<void> {
    const tournamentId = data?.tournamentId;
    if (!tournamentId || typeof tournamentId !== 'string') return;

    const { room } = publicTournamentChannel(tournamentId);
    await client.leave(room);
    const roomMembers = await this.server?.in(room).fetchSockets();
    const count = roomMembers?.length ?? '?';

    if (this.metricsEnabled) {
      this.logger.log(`[metrics:leave] id=${client.id} tournament=${tournamentId} roomSize=${count}`);
    } else {
      this.logger.log(`[room] Public client ${client.id} left ${room} — ${count} member(s)`);
    }
  }

  /**
   * Periodic summary of connected public clients and active tournament rooms.
   */
  private async logMetricsSummary(): Promise<void> {
    if (!this.server) return;

    const allSockets = await this.server.fetchSockets();
    const totalClients = allSockets.length;

    // Collect room membership counts (only tournament rooms)
    const roomCounts: Record<string, number> = {};
    for (const socket of allSockets) {
      for (const room of socket.rooms) {
        if (room.startsWith(PUBLIC_TOURNAMENT_ROOM_PREFIX)) {
          const tournamentId = room.slice(PUBLIC_TOURNAMENT_ROOM_PREFIX.length);
          roomCounts[tournamentId] = (roomCounts[tournamentId] || 0) + 1;
        }
      }
    }

    const roomEntries = Object.entries(roomCounts);
    const roomSummary = roomEntries.length ? roomEntries.map(([tid, count]) => `${tid}=${count}`).join(' ') : '(none)';

    this.logger.log(
      `[metrics:summary] totalClients=${totalClients} activeRooms=${roomEntries.length} rooms: ${roomSummary}`,
    );
  }
}
