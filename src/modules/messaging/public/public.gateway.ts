import { Logger, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';

const PUBLIC_ROOM_PREFIX = 'public:tournament:';

@Injectable()
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'public',
})
export class PublicGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublicGateway.name);
  private readonly metricsEnabled = process.env.PUBLIC_METRICS_LOG === 'true';
  private readonly metricsIntervalMs = Number(process.env.PUBLIC_METRICS_INTERVAL) || 60_000;
  private metricsTimer?: ReturnType<typeof setInterval>;

  @WebSocketServer()
  server?: Server;

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

    const room = PUBLIC_ROOM_PREFIX + tournamentId;
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

    const room = PUBLIC_ROOM_PREFIX + tournamentId;
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
   * Broadcast a sanitized public update to all public clients in a tournament room.
   * Called programmatically by TournamentBroadcastService after a successful mutation.
   */
  broadcastPublicUpdate(tournamentId: string, payload: any): void {
    if (!tournamentId || !payload) return;
    const room = PUBLIC_ROOM_PREFIX + tournamentId;
    this.server?.to(room).emit('publicUpdate', payload);
    this.logger.log(`[broadcast] publicUpdate to ${room} — type: ${payload.type}`);
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
        if (room.startsWith(PUBLIC_ROOM_PREFIX)) {
          const tournamentId = room.slice(PUBLIC_ROOM_PREFIX.length);
          roomCounts[tournamentId] = (roomCounts[tournamentId] || 0) + 1;
        }
      }
    }

    const roomEntries = Object.entries(roomCounts);
    const roomSummary = roomEntries.length
      ? roomEntries.map(([tid, count]) => `${tid}=${count}`).join(' ')
      : '(none)';

    this.logger.log(
      `[metrics:summary] totalClients=${totalClients} activeRooms=${roomEntries.length} rooms: ${roomSummary}`,
    );
  }
}
