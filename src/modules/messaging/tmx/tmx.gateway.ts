import { TournamentBroadcastService } from '../broadcast/tournament-broadcast.service';
import { canViewTournament, canMutateTournament } from 'src/modules/factory/helpers/checkTournamentAccess';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { buildUserContext } from 'src/modules/auth/helpers/buildUserContext';
import { AssignmentsService } from 'src/modules/factory/assignments.service';
import { UseGuards, Logger, Inject, Injectable } from '@nestjs/common';
import { Roles } from 'src/modules/auth/decorators/roles.decorator';
import { SocketGuard } from 'src/modules/auth/guards/socket.guard';
import { CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';
import { Public } from '../../auth/decorators/public.decorator';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import {
  USER_PROVIDER_STORAGE,
  type IUserProviderStorage,
  USER_STORAGE,
  type IUserStorage,
  PROVIDER_STORAGE,
  type IProviderStorage,
} from 'src/storage/interfaces';
import { UsersService } from 'src/modules/users/users.service';
import { tools } from 'tods-competition-factory';
import { tmxMessages } from './tmxMessages';
import { Namespace, Server, Socket } from 'socket.io';
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

export const TOURNAMENT_ROOM_PREFIX = 'tournament:';
const ADMIN_CHAT_MONITOR_ROOM = 'admin:chatMonitor';

export interface RoomMember {
  socketId: string;
  userId?: string;
  email?: string;
  providerId?: string;
  joinedAt?: number;
}

export interface RoomPresence {
  tournamentId: string;
  count: number;
  members: RoomMember[];
}

@Injectable()
@UseGuards(SocketGuard) // SocketGuard handles authentication as well as roles
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'tmx',
})
export class TmxGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(USER_PROVIDER_STORAGE) private readonly userProviderStorage: IUserProviderStorage,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly broadcastService: TournamentBroadcastService,
    private readonly assignmentsService: AssignmentsService,
    private readonly usersService: UsersService,
  ) {}

  private readonly logger = new Logger(TmxGateway.name);

  @WebSocketServer()
  server?: Server;

  afterInit(server: Server): void {
    this.broadcastService.setTmxServer(server);
    this.logger.log('TmxGateway initialized — broadcast service registered');
  }

  handleConnection(client: Socket): void {
    const hasAuth = !!client.handshake.headers.authorization;
    client.data.connectedAt = Date.now();
    client.data.tournamentJoinedAt = {} as Record<string, number>;
    this.logger.log(`[connect] Client ${client.id} connected (hasAuth: ${hasAuth})`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`[disconnect] Client ${client.id} disconnected`);
    // Socket.IO automatically removes the client from all rooms on disconnect.
    // Capture tournament rooms BEFORE the framework clears them so we can
    // rebroadcast presence to remaining members.
    const leavingTournamentIds: string[] = [];
    for (const room of client.rooms) {
      if (typeof room === 'string' && room.startsWith(TOURNAMENT_ROOM_PREFIX)) {
        leavingTournamentIds.push(room.slice(TOURNAMENT_ROOM_PREFIX.length));
      }
    }
    // Socket.IO removes the disconnecting client from rooms synchronously
    // after this handler returns; defer the count + broadcast a tick so the
    // departing socket is no longer counted.
    setImmediate(() => {
      for (const tournamentId of leavingTournamentIds) {
        void this.broadcastRoomPresence(tournamentId);
      }
    });
  }

  /** Count current sockets in a tournament room and emit `roomPresence` to that room. */
  private async broadcastRoomPresence(tournamentId: string): Promise<void> {
    if (!this.server) return;
    const room = TOURNAMENT_ROOM_PREFIX + tournamentId;
    const sockets = await this.server.in(room).fetchSockets();
    this.server.to(room).emit('roomPresence', { tournamentId, count: sockets.length });
  }

  // ── Tournament room management ──

  @SubscribeMessage('joinTournament')
  @Roles([CLIENT, SUPER_ADMIN])
  async joinTournament(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<void> {
    this.logger.log(`[room] joinTournament received from ${client.id} — data: ${JSON.stringify(data)}`);
    const tournamentId = data?.tournamentId;
    if (!tournamentId || typeof tournamentId !== 'string') {
      this.logger.warn(`[room] joinTournament rejected — invalid tournamentId: ${JSON.stringify(data)}`);
      return;
    }

    // Visibility check: can this user see this tournament?
    const userContext = await this.resolveUserContext(client);
    if (userContext) {
      const result: any = await this.tournamentStorageService.fetchTournamentRecords({ tournamentId });
      const tournament = result?.tournamentRecords?.[tournamentId];
      if (tournament) {
        const assignedIds = await this.assignmentsService.getAssignedTournamentIds(userContext.userId);
        if (!canViewTournament(tournament, userContext, assignedIds)) {
          this.logger.warn(`[room] joinTournament denied for ${client.id} — user cannot view ${tournamentId}`);
          client.emit('exception', { message: 'Not authorized to view this tournament' });
          return;
        }
      }
    }

    const room = TOURNAMENT_ROOM_PREFIX + tournamentId;
    await client.join(room);
    if (client.data.tournamentJoinedAt) {
      client.data.tournamentJoinedAt[tournamentId] = Date.now();
    }
    const roomMembers = await this.server?.in(room).fetchSockets();
    this.logger.log(`[room] Client ${client.id} joined ${room} — room now has ${roomMembers?.length ?? '?'} member(s)`);
    await this.broadcastRoomPresence(tournamentId);

    // Loading a tournament is the strongest signal of "active" we have.
    // - User: always stamp lastAccess (super-admins included; that's per-user
    //   activity, distinct from provider access).
    // - Provider: stamp the *tournament's* owning provider, not the user's
    //   home provider. The home-provider variant missed multi-provider users
    //   and credited the wrong provider in switcher/impersonation flows.
    //   Skip entirely for super-admins — their access never represents
    //   provider-level activity.
    const jwtUser = client.data?.user;
    const isSuperAdmin = (jwtUser?.roles ?? []).includes(SUPER_ADMIN);
    if (jwtUser?.email) {
      this.userStorage.updateLastAccess(jwtUser.email).catch((err: any) => {
        this.logger.warn(`updateLastAccess(user=${jwtUser.email}) failed: ${err?.message ?? err}`);
      });
    }
    // Gate on an authenticated user — unverified joins (which the @Roles
    // guard normally blocks) should never credit a provider, and super-admin
    // access never represents provider-level activity.
    if (jwtUser?.email && !isSuperAdmin) {
      this.providerStorage.updateLastAccessByTournament(tournamentId).catch((err: any) => {
        this.logger.warn(`updateLastAccessByTournament(tournament=${tournamentId}) failed: ${err?.message ?? err}`);
      });
    }
  }

  @SubscribeMessage('leaveTournament')
  @Roles([CLIENT, SUPER_ADMIN])
  async leaveTournament(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<void> {
    this.logger.log(`[room] leaveTournament received from ${client.id} — data: ${JSON.stringify(data)}`);
    const tournamentId = data?.tournamentId;
    if (!tournamentId || typeof tournamentId !== 'string') return;

    const room = TOURNAMENT_ROOM_PREFIX + tournamentId;
    await client.leave(room);
    const roomMembers = await this.server?.in(room).fetchSockets();
    this.logger.log(`[room] Client ${client.id} left ${room} — room now has ${roomMembers?.length ?? '?'} member(s)`);
    await this.broadcastRoomPresence(tournamentId);
  }

  // ── Mutation handling with broadcast ──

  @SubscribeMessage('executionQueue')
  @Roles([CLIENT, SUPER_ADMIN])
  async messageHandler(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<any> {
    if (typeof data !== 'object') return { notFound: data };
    const { type, payload = {} } = data;

    // Use the JWT-verified user identity from the SocketGuard, NOT the
    // client-supplied payload.userId. The guard stores the verified user
    // on client.data.user — see socket.guard.ts.
    const verifiedUser = client.data?.user;
    const userId = verifiedUser?.email ?? payload.userId;

    if (tmxMessages[type]) {
      const methods = tools.unique(payload?.methods?.map((directive) => directive.method) ?? []).join('|');

      // Per-tournament mutation check (behind feature flag via canMutateTournament)
      const userContext = await this.resolveUserContext(client);
      if (userContext && payload.tournamentIds?.length) {
        const assignedIds = await this.assignmentsService.getAssignedTournamentIds(userContext.userId);
        for (const tid of payload.tournamentIds) {
          const result: any = await this.tournamentStorageService.fetchTournamentRecords({ tournamentId: tid });
          const tournament = result?.tournamentRecords?.[tid];
          if (tournament && !canMutateTournament(tournament, userContext, assignedIds)) {
            this.logger.warn(`[executionQueue] mutation denied for ${userId}: ${methods} on ${tid}`);
            const ackId = payload?.ackId;
            client.emit('ack', { ackId, error: 'Not authorized to modify this tournament' });
            return;
          }
        }
      }

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
            `${type} message errored: ${userId}: ${methods}${tournamentInfo} | error: ${JSON.stringify(result.error)}`,
          );
        } else {
          this.logger.debug(`${type} message successful: ${userId}: ${methods}`);
          // Broadcast approved mutations to other TMX clients viewing the same tournament(s)
          this.broadcastService.broadcastMutation(payload, client);
          // Broadcast sanitized updates to public viewers
          this.broadcastService.broadcastPublicNotices(payload, result.publicNotices);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`${type} message threw: ${userId}: ${methods} | error: ${message}`);
        const ackId = payload?.ackId;
        client.emit('ack', { ackId, error: message });
      }
    } else {
      this.logger.debug(`Not found: ${type}`);
    }
  }

  // ── Chat relay ──

  @SubscribeMessage('chatMessage')
  @Roles([CLIENT, SUPER_ADMIN])
  async chatMessage(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<void> {
    const tournamentId = data?.tournamentId;
    if (!tournamentId || !data?.message) return;

    const room = TOURNAMENT_ROOM_PREFIX + tournamentId;
    const payload = {
      userName: data.userName,
      message: data.message,
      timestamp: Date.now(),
    };

    // Relay to other clients in the tournament room
    client.to(room).emit('chatMessage', payload);

    // Also relay to the admin chat monitor room so super-admins can see
    // all chat across all providers/tournaments in real time.
    this.server?.to(ADMIN_CHAT_MONITOR_ROOM).emit('adminChatFeed', {
      ...payload,
      tournamentId,
      providerId: data.providerId,
      providerAbbr: data.providerAbbr,
      tournamentName: data.tournamentName,
    });
  }

  // ── Admin chat monitor (SUPER_ADMIN only) ──

  /**
   * Super-admin joins the global chat monitor room to receive all chat
   * messages across all tournaments and providers.
   */
  @SubscribeMessage('joinChatMonitor')
  @Roles([SUPER_ADMIN])
  async joinChatMonitor(@ConnectedSocket() client: Socket): Promise<void> {
    await client.join(ADMIN_CHAT_MONITOR_ROOM);
    this.logger.log(`[chat-monitor] ${client.id} joined admin chat monitor`);
  }

  @SubscribeMessage('leaveChatMonitor')
  @Roles([SUPER_ADMIN])
  async leaveChatMonitor(@ConnectedSocket() client: Socket): Promise<void> {
    await client.leave(ADMIN_CHAT_MONITOR_ROOM);
    this.logger.log(`[chat-monitor] ${client.id} left admin chat monitor`);
  }

  /**
   * Super-admin sends a message into a specific tournament room from the
   * chat monitor. The message appears as a regular chatMessage to all
   * clients in that tournament room.
   */
  @SubscribeMessage('adminChatReply')
  @Roles([SUPER_ADMIN])
  async adminChatReply(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<void> {
    const tournamentId = data?.tournamentId;
    if (!tournamentId || !data?.message) return;

    const verifiedUser = client.data?.user;
    const userName = data.userName || verifiedUser?.email || 'Admin';

    const room = TOURNAMENT_ROOM_PREFIX + tournamentId;
    const payload = {
      userName,
      message: data.message,
      timestamp: Date.now(),
      isAdmin: true,
    };

    // Send to the tournament room (all clients including the admin if they're in that room)
    this.server?.to(room).emit('chatMessage', payload);

    // Also echo back to the monitor room so other monitoring admins see it
    this.server?.to(ADMIN_CHAT_MONITOR_ROOM).emit('adminChatFeed', {
      ...payload,
      tournamentId,
      providerId: data.providerId,
      providerAbbr: data.providerAbbr,
      tournamentName: data.tournamentName,
    });

    this.logger.log(`[chat-monitor] admin reply to ${tournamentId}: ${data.message.substring(0, 50)}`);
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

  // ── Admin presence query ──

  /**
   * Snapshot of every active tournament room and the sockets currently in it.
   * Backs the GET /admin/presence endpoint. Read-only — no broadcast.
   */
  async getActiveRoomPresence(): Promise<RoomPresence[]> {
    if (!this.server) return [];
    // `this.server` is typed as `Server`, but with `namespace: 'tmx'` NestJS
    // injects a `Namespace` at runtime. On a Namespace the adapter sits
    // directly on the instance — `this.server.sockets` is a Map<id,Socket>,
    // not a default-namespace shim, so the previous chain
    // `this.server.sockets.adapter.rooms` produced
    // "Cannot read properties of undefined (reading 'rooms')" in prod.
    const rooms = (this.server as unknown as Namespace).adapter.rooms;
    const tournamentIds: string[] = [];
    for (const room of rooms.keys()) {
      if (room.startsWith(TOURNAMENT_ROOM_PREFIX)) {
        tournamentIds.push(room.slice(TOURNAMENT_ROOM_PREFIX.length));
      }
    }

    const result: RoomPresence[] = [];
    for (const tournamentId of tournamentIds) {
      const room = TOURNAMENT_ROOM_PREFIX + tournamentId;
      const sockets = await this.server.in(room).fetchSockets();
      const members: RoomMember[] = sockets.map((s) => {
        const jwtUser = (s.data as any)?.user;
        const joinedAt = (s.data as any)?.tournamentJoinedAt?.[tournamentId];
        return {
          socketId: s.id,
          userId: jwtUser?.userId ?? jwtUser?.sub,
          email: jwtUser?.email,
          providerId: jwtUser?.providerId,
          joinedAt,
        };
      });
      result.push({ tournamentId, count: members.length, members });
    }
    return result;
  }

  // ── User context resolution for WebSocket handlers ──

  /**
   * Resolve the multi-provider UserContext for a connected socket.
   * Uses the JWT-verified user stored on client.data by the SocketGuard,
   * then hydrates the full user record + provider associations from the DB.
   */
  private async resolveUserContext(client: Socket) {
    const jwtUser = client.data?.user;
    if (!jwtUser?.email) return undefined;
    try {
      const fullUser = await this.usersService.findOne(jwtUser.email);
      if (!fullUser) return undefined;
      return await buildUserContext(fullUser, this.userProviderStorage);
    } catch {
      return undefined;
    }
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
