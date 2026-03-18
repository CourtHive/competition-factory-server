import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { UseGuards, Logger, Inject, Injectable } from '@nestjs/common';
import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { SocketGuard } from 'src/modules/auth/guards/socket.guard';
import { CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';
import { Public } from '../../auth/decorators/public.decorator';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { tools } from 'tods-competition-factory';
import { tmxMessages } from './tmxMessages';
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

const TOURNAMENT_ROOM_PREFIX = 'tournament:';

@Injectable()
@UseGuards(SocketGuard) // SocketGuard handles authentication as well as roles
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'tmx',
})
export class TmxGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly tournamentStorageService: TournamentStorageService,
  ) {}

  private readonly logger = new Logger(TmxGateway.name);

  @WebSocketServer()
  server?: Server;

  handleConnection(client: Socket): void {
    const hasAuth = !!client.handshake.headers.authorization;
    this.logger.log(`[connect] Client ${client.id} connected (hasAuth: ${hasAuth})`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`[disconnect] Client ${client.id} disconnected`);
    // Socket.IO automatically removes the client from all rooms on disconnect
  }

  // ── Tournament room management ──

  @SubscribeMessage('joinTournament')
  @Public()
  async joinTournament(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<void> {
    this.logger.log(`[room] joinTournament received from ${client.id} — data: ${JSON.stringify(data)}`);
    const tournamentId = data?.tournamentId;
    if (!tournamentId || typeof tournamentId !== 'string') {
      this.logger.warn(`[room] joinTournament rejected — invalid tournamentId: ${JSON.stringify(data)}`);
      return;
    }

    const room = TOURNAMENT_ROOM_PREFIX + tournamentId;
    await client.join(room);
    const roomMembers = await this.server?.in(room).fetchSockets();
    this.logger.log(`[room] Client ${client.id} joined ${room} — room now has ${roomMembers?.length ?? '?'} member(s)`);
  }

  @SubscribeMessage('leaveTournament')
  @Public()
  async leaveTournament(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<void> {
    this.logger.log(`[room] leaveTournament received from ${client.id} — data: ${JSON.stringify(data)}`);
    const tournamentId = data?.tournamentId;
    if (!tournamentId || typeof tournamentId !== 'string') return;

    const room = TOURNAMENT_ROOM_PREFIX + tournamentId;
    await client.leave(room);
    const roomMembers = await this.server?.in(room).fetchSockets();
    this.logger.log(`[room] Client ${client.id} left ${room} — room now has ${roomMembers?.length ?? '?'} member(s)`);
  }

  // ── Mutation handling with broadcast ──

  @SubscribeMessage('executionQueue')
  @Roles([CLIENT, SUPER_ADMIN])
  async messageHandler(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<any> {
    if (typeof data !== 'object') return { notFound: data };
    const { type, payload = {} } = data;
    if (tmxMessages[type]) {
      const methods = tools.unique(payload?.methods?.map((directive) => directive.method) ?? []).join('|');
      try {
        const result = await tmxMessages[type]({
          client,
          payload,
          services: { cacheManager: this.cacheManager },
          storage: this.tournamentStorageService,
        });
        if (result.error) {
          const tournamentInfo = result.tournamentIds ? ` | tournaments: ${JSON.stringify(result.tournamentIds)}` : '';
          this.logger.error(
            `${type} message errored: ${payload.userId}: ${methods}${tournamentInfo} | error: ${JSON.stringify(result.error)}`,
          );
        } else {
          this.logger.debug(`${type} message successful: ${payload.userId}: ${methods}`);
          // Broadcast approved mutations to other clients viewing the same tournament(s)
          this.broadcastMutation(client, payload);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`${type} message threw: ${payload.userId}: ${methods} | error: ${message}`);
        const ackId = payload?.ackId;
        client.emit('ack', { ackId, error: message });
      }
    } else {
      this.logger.debug(`Not found: ${type}`);
    }
  }

  /**
   * Broadcast an approved executionQueue to all other clients
   * that have joined the affected tournament room(s).
   */
  private async broadcastMutation(sender: Socket, payload: any): Promise<void> {
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
      const roomMembers = await this.server?.in(room).fetchSockets();
      const memberIds = roomMembers?.map((s) => s.id) ?? [];
      this.logger.log(
        `[broadcast] room ${room} has ${memberIds.length} member(s): [${memberIds.join(', ')}] — sender: ${sender.id}`,
      );
      // .to(room) sends to everyone in the room EXCEPT the sender
      sender.to(room).emit('tournamentMutation', broadcast);
    }

    const methodNames = tools.unique(methods.map((m) => m.method) ?? []).join('|');
    this.logger.log(
      `[broadcast] sent ${methods.length} mutation(s) [${methodNames}] to rooms: ${tournamentIds.join(', ')} (excluding sender ${sender.id})`,
    );
  }

  @SubscribeMessage('tmx')
  @Roles([CLIENT, SUPER_ADMIN])
  async tmx(@MessageBody() data: any): Promise<any> {
    this.logger.debug(`tmx message successful -- no action taken (yet)`, { data });
    return { event: 'ack', data }; // emit to client
  }

  @SubscribeMessage('timestamp')
  @Roles([CLIENT, SUPER_ADMIN])
  async timestamp(@MessageBody() data: any): Promise<any> {
    this.logger.verbose(`client timestamp: ${data.timestamp}`);
    return { event: 'timestamp', data: { timestamp: Date.now() } }; // emit to client
  }

  @SubscribeMessage('test')
  @Public()
  async test(@MessageBody() data: any): Promise<any> {
    if (data?.payload?.cache && typeof data.payload.cache === 'string') {
      const cachedData = await this.cacheManager.get(data.payload.cache);
      if (!cachedData) {
        console.log({ cachedData: 'not found' });
        await this.cacheManager.set(data.payload.cache, data.payload, data.payload.ttl);
      } else {
        console.log({ cachedData });
      }
    }

    this.logger.debug(`test route successful`);
    return { event: 'ack', data }; // emit to client
  }
}
