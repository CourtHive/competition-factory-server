import { initRoomJoins, recordRoomJoin, SocketIoRealtimeAdapter } from '../realtime/socket-io-realtime.adapter';
import { buildUserContext } from 'src/modules/account/auth/helpers/buildUserContext';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { MAX_CHAT_MESSAGE_LENGTH, toAdminFeed, toWireMessage } from './chatWire';
import { AssignmentsService } from 'src/modules/factory/assignments.service';
import { Roles } from 'src/modules/account/auth/decorators/roles.decorator';
import { SocketGuard } from 'src/modules/account/auth/guards/socket.guard';
import { Public } from '../../account/auth/decorators/public.decorator';
import { UseGuards, Logger, Inject, Injectable } from '@nestjs/common';
import { TournamentChatService } from './tournament-chat.service';
import { CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';
import { UsersService } from 'src/modules/users/users.service';
import { userCanViewTournament } from './tournamentVisibility';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { resolveCorsOrigins } from 'src/common/cors';
import { Server, Socket } from 'socket.io';
import {
  TOURNAMENT_ROOM_PREFIX,
  ADMIN_CHAT_MONITOR_ROOM,
  tournamentChannel,
  adminChatMonitorChannel,
} from '../realtime/channels';
import {
  USER_PROVIDER_STORAGE,
  type IUserProviderStorage,
  USER_PROVISIONER_STORAGE,
  type IUserProvisionerStorage,
  PROVISIONER_PROVIDER_STORAGE,
  type IProvisionerProviderStorage,
  USER_STORAGE,
  type IUserStorage,
  PROVIDER_STORAGE,
  type IProviderStorage,
  CHAT_STORAGE,
  type IChatStorage,
} from 'src/storage/interfaces';
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
  cors: { origin: resolveCorsOrigins(process.env.CFS_CORS_ORIGINS) },
  namespace: 'tmx',
})
export class TmxGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(USER_PROVIDER_STORAGE) private readonly userProviderStorage: IUserProviderStorage,
    @Inject(USER_PROVISIONER_STORAGE) private readonly userProvisionerStorage: IUserProvisionerStorage,
    @Inject(PROVISIONER_PROVIDER_STORAGE)
    private readonly provisionerProviderStorage: IProvisionerProviderStorage,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(CHAT_STORAGE) private readonly chatStorage: IChatStorage,
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly assignmentsService: AssignmentsService,
    private readonly usersService: UsersService,
    private readonly realtime: SocketIoRealtimeAdapter,
    private readonly tournamentChat: TournamentChatService,
  ) {}

  private readonly logger = new Logger(TmxGateway.name);

  @WebSocketServer()
  server?: Server;

  afterInit(server: Server): void {
    this.realtime.bind('tmx', server);
    this.logger.log('TmxGateway initialized — /tmx bound to the realtime port');
  }

  handleConnection(client: Socket): void {
    const hasAuth = !!client.handshake.headers.authorization;
    client.data.connectedAt = Date.now();
    initRoomJoins(client);
    // Socket.IO empties `client.rooms` BEFORE it emits `disconnect` (`_onclose` runs `_cleanup()` →
    // `leaveAll()` between the two events), so the rooms a departing socket was in can only be read
    // on `disconnecting`. Reading them in handleDisconnect, as this did until 2026-10-08, always saw
    // none: no `roomPresence` was ever rebroadcast when a tab closed or dropped, and the chat
    // "online" count only fell when someone left a room explicitly.
    client.on('disconnecting', () => this.rebroadcastPresenceOnLeave(client));
    this.logger.log(`[connect] Client ${client.id} connected (hasAuth: ${hasAuth})`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`[disconnect] Client ${client.id} disconnected`);
  }

  private rebroadcastPresenceOnLeave(client: Socket): void {
    const leavingTournamentIds: string[] = [];
    for (const room of client.rooms) {
      if (typeof room === 'string' && room.startsWith(TOURNAMENT_ROOM_PREFIX)) {
        leavingTournamentIds.push(room.slice(TOURNAMENT_ROOM_PREFIX.length));
      }
    }
    // The socket leaves its rooms synchronously after `disconnecting`; count a tick later so the
    // departing socket is no longer included.
    setImmediate(() => {
      for (const tournamentId of leavingTournamentIds) {
        this.broadcastRoomPresence(tournamentId).catch((err) =>
          this.logger.warn(`[presence] rebroadcast failed for ${tournamentId}: ${(err as Error)?.message ?? err}`),
        );
      }
    });
  }

  /** Count current connections in a tournament room and publish `roomPresence` to that room. */
  private async broadcastRoomPresence(tournamentId: string): Promise<void> {
    const channel = tournamentChannel(tournamentId);
    const members = await this.realtime.members(channel);
    this.realtime.publish(channel, 'roomPresence', { tournamentId, count: members.length });
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
    const canView = await userCanViewTournament({
      tournamentId,
      userContext: await this.resolveUserContext(client),
      storage: this.tournamentStorageService,
      assignments: this.assignmentsService,
    });
    if (!canView) {
      this.logger.warn(`[room] joinTournament denied for ${client.id} — user cannot view ${tournamentId}`);
      client.emit('exception', { message: 'Not authorized to view this tournament' });
      return;
    }

    const { room } = tournamentChannel(tournamentId);
    await client.join(room);
    recordRoomJoin(client, room);
    const roomMembers = await this.realtime.members(tournamentChannel(tournamentId));
    this.logger.log(`[room] Client ${client.id} joined ${room} — room now has ${roomMembers.length} member(s)`);
    await this.broadcastRoomPresence(tournamentId);

    // Backfill recent chat to the joining socket only. The visibility check
    // above already gated entry into the room, so this needs no extra gate.
    const { records: chatHistory } = await this.chatStorage.recentMessages({ tournamentId });
    client.emit('chatHistory', { tournamentId, messages: (chatHistory ?? []).map(toWireMessage) });

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

    const { room } = tournamentChannel(tournamentId);
    await client.leave(room);
    const roomMembers = await this.realtime.members(tournamentChannel(tournamentId));
    this.logger.log(`[room] Client ${client.id} left ${room} — room now has ${roomMembers.length} member(s)`);
    await this.broadcastRoomPresence(tournamentId);
  }

  // ── Mutations ──
  //
  // Commands are not accepted on the socket. A mutation is `POST /factory` (FactoryController), which
  // authorizes, stamps identity, executes, broadcasts to this namespace and evicts the public caches.
  // The socket `executionQueue` handler was retired on 2026-10-09 (CA): it duplicated that path and
  // could not evict the cache tiers whose keys only the controller tracks.

  // ── Chat relay ──

  @SubscribeMessage('chatMessage')
  @Roles([CLIENT, SUPER_ADMIN])
  async chatMessage(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<void> {
    // Shared with POST /tmx/chat (TournamentChatService). The relay excludes this connection; the
    // sender reconciles its optimistic copy from the ack below.
    const result = await this.tournamentChat.send(data, {
      userContext: await this.resolveUserContext(client),
      verifiedUser: client.data?.user,
      excludeConnectionId: client.id,
    });
    if ('accepted' in result) client.emit('chatAccepted', result.accepted);
    if ('rejected' in result) client.emit('chatRejected', result.rejected);
  }

  /**
   * Gap fill: a client that detects its `lastSeenSeq` trails the latest seq it
   * has observed requests everything newer. Gated by current room membership —
   * the socket can only be in the room if `joinTournament` (with its
   * `canViewTournament` check) succeeded, so no separate auth path is needed.
   */
  @SubscribeMessage('chatSince')
  @Roles([CLIENT, SUPER_ADMIN])
  async chatSince(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<void> {
    const tournamentId = data?.tournamentId;
    const afterSeq = Number(data?.afterSeq);
    if (!tournamentId || !Number.isFinite(afterSeq)) return;
    if (!client.rooms.has(tournamentChannel(tournamentId).room)) return;

    const { records } = await this.chatStorage.messagesSince({ tournamentId, afterSeq });
    client.emit('chatHistory', { tournamentId, gap: true, messages: (records ?? []).map(toWireMessage) });
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

    // Backfill the most-recent cross-tournament page so the monitor opens
    // populated regardless of how recent the last activity was. The client
    // can page further back via `adminChatLoadOlder` to the 30d retention edge.
    const { records } = await this.chatStorage.adminMessagesBefore({});
    client.emit('adminChatHistory', { messages: (records ?? []).map(toAdminFeed), older: false });
  }

  /**
   * Super-admin pages back through cross-tournament history. Returns the page
   * of messages immediately older than `beforeSeq` (the oldest seq the client
   * currently holds). An empty `messages` array signals the retention edge —
   * the client disables its "load older" affordance.
   */
  @SubscribeMessage('adminChatLoadOlder')
  @Roles([SUPER_ADMIN])
  async adminChatLoadOlder(@MessageBody() data: any, @ConnectedSocket() client: Socket): Promise<void> {
    if (!client.rooms.has(ADMIN_CHAT_MONITOR_ROOM)) return;
    const beforeSeq = Number(data?.beforeSeq);
    if (!Number.isFinite(beforeSeq)) return;

    const { records } = await this.chatStorage.adminMessagesBefore({ beforeSeq });
    client.emit('adminChatHistory', { messages: (records ?? []).map(toAdminFeed), older: true });
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
    const message = String(data.message).slice(0, MAX_CHAT_MESSAGE_LENGTH);

    // Persist the admin reply too (is_admin) so it appears in tournament
    // backfill and gap fills like any other message. Tolerate persist failure
    // — still relay so the live experience degrades gracefully.
    const { record } = await this.chatStorage.appendMessage({
      tournamentId,
      providerId: data.providerId,
      providerAbbr: data.providerAbbr,
      tournamentName: data.tournamentName,
      userName,
      message,
      isAdmin: true,
    });
    const wire = record ? toWireMessage(record) : { userName, message, timestamp: Date.now(), isAdmin: true };

    // Send to the tournament room (all clients including the admin if they're in that room)
    this.realtime.publish(tournamentChannel(tournamentId), 'chatMessage', wire);

    // Also echo back to the monitor room so other monitoring admins see it
    this.realtime.publish(
      adminChatMonitorChannel(),
      'adminChatFeed',
      record
        ? toAdminFeed(record)
        : {
            ...wire,
            tournamentId,
            providerId: data.providerId,
            providerAbbr: data.providerAbbr,
            tournamentName: data.tournamentName,
          },
    );

    this.logger.log(`[chat-monitor] admin reply to ${tournamentId}: ${message.substring(0, 50)}`);
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
    const rooms = await this.realtime.rooms('tmx', TOURNAMENT_ROOM_PREFIX);
    const result: RoomPresence[] = [];
    for (const room of rooms) {
      const tournamentId = room.slice(TOURNAMENT_ROOM_PREFIX.length);
      const members: RoomMember[] = (await this.realtime.members(tournamentChannel(tournamentId))).map((m) => ({
        socketId: m.connectionId,
        userId: m.user?.userId ?? m.user?.sub,
        email: m.user?.email,
        providerId: m.user?.providerId,
        joinedAt: m.joinedAt,
      }));
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
      return await buildUserContext(fullUser, {
        userProviderStorage: this.userProviderStorage,
        userProvisionerStorage: this.userProvisionerStorage,
        provisionerProviderStorage: this.provisionerProviderStorage,
      });
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
        await this.cacheManager.set(data.payload.cache, data.payload, data.payload.ttl);
      }
    }

    this.logger.debug(`test route successful`);
    return { event: 'ack', data }; // emit to client
  }
}
