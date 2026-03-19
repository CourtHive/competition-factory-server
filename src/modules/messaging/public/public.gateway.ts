import { Logger, Injectable } from '@nestjs/common';
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
export class PublicGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PublicGateway.name);

  @WebSocketServer()
  server?: Server;

  handleConnection(client: Socket): void {
    this.logger.log(`[connect] Public client ${client.id} connected`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`[disconnect] Public client ${client.id} disconnected`);
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
    this.logger.log(`[room] Public client ${client.id} joined ${room} — ${roomMembers?.length ?? '?'} member(s)`);
  }

  @SubscribeMessage('leaveTournament')
  async leaveTournament(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<void> {
    const tournamentId = data?.tournamentId;
    if (!tournamentId || typeof tournamentId !== 'string') return;

    const room = PUBLIC_ROOM_PREFIX + tournamentId;
    await client.leave(room);
    const roomMembers = await this.server?.in(room).fetchSockets();
    this.logger.log(`[room] Public client ${client.id} left ${room} — ${roomMembers?.length ?? '?'} member(s)`);
  }

  /**
   * Broadcast a sanitized public update to all public clients in a tournament room.
   * Called programmatically by TmxGateway after a successful mutation.
   */
  broadcastPublicUpdate(tournamentId: string, payload: any): void {
    if (!tournamentId || !payload) return;
    const room = PUBLIC_ROOM_PREFIX + tournamentId;
    this.server?.to(room).emit('publicUpdate', payload);
    this.logger.log(`[broadcast] publicUpdate to ${room} — type: ${payload.type}`);
  }
}
