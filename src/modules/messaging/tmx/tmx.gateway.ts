import { computeEffectiveConfig, isMutationAllowed } from '@courthive/provider-config';
import { TournamentBroadcastService } from '../broadcast/tournament-broadcast.service';
import { canViewTournament, canMutateTournament } from 'src/modules/factory/helpers/checkTournamentAccess';
import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { buildUserContext } from 'src/modules/account/auth/helpers/buildUserContext';
import { AssignmentsService } from 'src/modules/factory/assignments.service';
import { AuditService } from 'src/modules/audit/audit.service';
import { UseGuards, Logger, Inject, Injectable } from '@nestjs/common';
import { Roles } from 'src/modules/account/auth/decorators/roles.decorator';
import { SocketGuard } from 'src/modules/account/auth/guards/socket.guard';
import { CLIENT, SUPER_ADMIN } from 'src/common/constants/roles';
import { Public } from '../../account/auth/decorators/public.decorator';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
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
  type ChatMessageRecord,
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
const MAX_CHAT_MESSAGE_LENGTH = 2000;

/** Shape a persisted chat record into the `chatMessage`/`chatHistory` wire
 *  payload clients consume (timestamp in epoch ms, like the legacy relay). */
function toWireMessage(record: ChatMessageRecord): {
  seq: number;
  userName: string;
  message: string;
  timestamp: number;
  clientMsgId?: string;
  isAdmin: boolean;
} {
  return {
    seq: record.seq,
    userName: record.userName,
    message: record.message,
    timestamp: Date.parse(record.createdAt),
    clientMsgId: record.clientMsgId,
    isAdmin: record.isAdmin,
  };
}

/** Wire shape for the super-admin monitor — adds the provider/tournament
 *  identity used to render the grouping pills. */
function toAdminFeed(record: ChatMessageRecord): Record<string, any> {
  return {
    ...toWireMessage(record),
    tournamentId: record.tournamentId,
    providerId: record.providerId,
    providerAbbr: record.providerAbbr,
    tournamentName: record.tournamentName,
  };
}

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
    @Inject(USER_PROVISIONER_STORAGE) private readonly userProvisionerStorage: IUserProvisionerStorage,
    @Inject(PROVISIONER_PROVIDER_STORAGE)
    private readonly provisionerProviderStorage: IProvisionerProviderStorage,
    @Inject(USER_STORAGE) private readonly userStorage: IUserStorage,
    @Inject(PROVIDER_STORAGE) private readonly providerStorage: IProviderStorage,
    @Inject(CHAT_STORAGE) private readonly chatStorage: IChatStorage,
    private readonly tournamentStorageService: TournamentStorageService,
    private readonly broadcastService: TournamentBroadcastService,
    private readonly assignmentsService: AssignmentsService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
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
      const ackId = payload?.ackId;

      // Per-tournament gates: tournament-access (canMutateTournament) +
      // provider-permission (MUTATION_PERMISSIONS). Returns an error
      // string if any gate rejects, or null when all tournaments pass.
      const userContext = await this.resolveUserContext(client);
      const requestedMethods: string[] = (payload?.methods ?? []).map((m: any) => m?.method).filter(Boolean);
      const denial = await this.gatePerTournament(userContext, payload.tournamentIds ?? [], requestedMethods, userId, methods);
      if (denial) {
        client.emit('ack', { ackId, error: denial });
        return;
      }

      // Stamp the JWT-verified identity onto the payload so downstream
      // consumers (audit hook, executionQueue) see the authenticated
      // user rather than whatever the client happened to send.
      //
      // Only assign `userId` when the JWT actually carries a UUID-shaped
      // identifier — `audit_log.user_id` is UUID-typed (and nullable),
      // so falling back to `email` here would crash the INSERT with
      // `invalid input syntax for type uuid: "..."`. The email belongs in
      // `userEmail` (which maps to `audit_log.user_email TEXT`).
      if (verifiedUser?.email) {
        payload.userEmail = verifiedUser.email;
      }
      if (verifiedUser?.userId || verifiedUser?.sub) {
        payload.userId = verifiedUser.userId ?? verifiedUser.sub;
      }

      try {
        const result = await tmxMessages[type]({
          client,
          payload,
          services: { cacheManager: this.cacheManager },
          storage: this.tournamentStorageService,
          auditService: this.auditService,
        });
        if (result.error) {
          const tournamentInfo = result.tournamentIds ? ` | tournaments: ${JSON.stringify(result.tournamentIds)}` : '';
          const contextInfo = result.context ? ` | context: ${JSON.stringify(result.context)}` : '';
          // Include ackId + full methods (params and all) in error logs so
          // production incidents are triageable without needing the audit
          // DB. Capped at 2000 chars per log to avoid excessive spam from
          // large batches.
          const methodsDetail = safeJson(payload?.methods, 2000);
          this.logger.error(
            `${type} message errored: ${userId}: ${methods}${tournamentInfo} | ackId: ${ackId} | error: ${JSON.stringify(result.error)}${contextInfo} | methods: ${methodsDetail}`,
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
        const methodsDetail = safeJson(payload?.methods, 2000);
        this.logger.error(
          `${type} message threw: ${userId}: ${methods} | ackId: ${ackId} | error: ${message} | methods: ${methodsDetail}`,
        );
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
    const message = typeof data?.message === 'string' ? data.message.slice(0, MAX_CHAT_MESSAGE_LENGTH) : '';
    if (!tournamentId || !message.trim()) return;

    // Persist first — the assigned seq is the authoritative ordering key that
    // makes backfill + gap-detection work. Only relay what was durably stored.
    const { record, error } = await this.chatStorage.appendMessage({
      tournamentId,
      providerId: data.providerId,
      providerAbbr: data.providerAbbr,
      tournamentName: data.tournamentName,
      userName: data.userName,
      message,
      clientMsgId: data.clientMsgId,
    });
    if (error || !record) {
      this.logger.warn(`[chat] persist failed for ${tournamentId}: ${error}`);
      client.emit('chatRejected', { clientMsgId: data.clientMsgId, error: error ?? 'persist failed' });
      return;
    }

    const wire = toWireMessage(record);
    const room = TOURNAMENT_ROOM_PREFIX + tournamentId;

    // Relay to other clients in the room (sender excluded — it reconciles its
    // optimistic copy via the ack below, avoiding a duplicate render).
    client.to(room).emit('chatMessage', wire);

    // Ack the sender with the authoritative seq so its optimistic message is
    // confirmed and de-duplicated against any later history / gap fetch.
    client.emit('chatAccepted', { clientMsgId: record.clientMsgId, seq: record.seq, timestamp: wire.timestamp });

    // Mirror to the super-admin monitor room (live cross-tournament feed).
    this.server?.to(ADMIN_CHAT_MONITOR_ROOM).emit('adminChatFeed', toAdminFeed(record));
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
    const room = TOURNAMENT_ROOM_PREFIX + tournamentId;
    if (!client.rooms.has(room)) return;

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

    const room = TOURNAMENT_ROOM_PREFIX + tournamentId;

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
    const wire = record
      ? toWireMessage(record)
      : { userName, message, timestamp: Date.now(), isAdmin: true };

    // Send to the tournament room (all clients including the admin if they're in that room)
    this.server?.to(room).emit('chatMessage', wire);

    // Also echo back to the monitor room so other monitoring admins see it
    this.server?.to(ADMIN_CHAT_MONITOR_ROOM).emit(
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

  /**
   * Defense-in-depth gates applied before a mutation reaches `executionQueue`:
   *   1. canMutateTournament (per-tournament access)
   *   2. provider permission map (MUTATION_PERMISSIONS in the tournament's
   *      owning provider's effective config)
   *
   * Super-admins bypass both. Returns the denial reason as a string when
   * any tournament rejects, or `null` when all clear.
   */
  private async gatePerTournament(
    userContext: any,
    tournamentIds: string[],
    requestedMethods: string[],
    userId: string,
    methods: string,
  ): Promise<string | null> {
    if (!userContext || !tournamentIds.length) return null;

    const assignedIds = await this.assignmentsService.getAssignedTournamentIds(userContext.userId);
    for (const tid of tournamentIds) {
      const result: any = await this.tournamentStorageService.fetchTournamentRecords({ tournamentId: tid });
      const tournament = result?.tournamentRecords?.[tid];
      if (!tournament) continue;

      if (!canMutateTournament(tournament, userContext, assignedIds)) {
        this.logger.warn(`[executionQueue] mutation denied for ${userId}: ${methods} on ${tid}`);
        return 'Not authorized to modify this tournament';
      }

      if (userContext.isSuperAdmin || !requestedMethods.length) continue;
      const blocked = await this.checkProviderPermissionGate(tournament, requestedMethods);
      if (blocked) {
        this.logger.warn(
          `[executionQueue] provider permission denied for ${userId}: ${blocked.method} on ${tid} (provider ${blocked.providerId})`,
        );
        return `Action not permitted: ${blocked.method}`;
      }
    }
    return null;
  }

  /** Returns the first method blocked by the owning provider's permissions, or null. */
  private async checkProviderPermissionGate(
    tournament: any,
    requestedMethods: string[],
  ): Promise<{ method: string; providerId: string } | null> {
    const providerId = tournament?.parentOrganisation?.organisationId;
    if (!providerId) return null;
    const provider: any = await this.providerStorage.getProvider(providerId);
    const effective = computeEffectiveConfig(
      provider?.providerConfigCaps ?? {},
      provider?.providerConfigSettings ?? {},
    );
    const permissions = effective.permissions ?? {};
    const method = requestedMethods.find((m) => !isMutationAllowed(m, permissions));
    return method ? { method, providerId } : null;
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

function safeJson(value: unknown, maxLen: number): string {
  try {
    const s = JSON.stringify(value);
    if (s == null) return String(s);
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return '[unserializable]';
  }
}
