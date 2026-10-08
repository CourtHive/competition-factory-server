/**
 * HiveIDGateway — authenticated public-side socket namespace.
 *
 * Namespace: `/hiveid` (sibling to `/public` which stays open for
 * anonymous tournament viewing). Every connection must present a JWT
 * whose `aud` claim includes `'hiveid'`; the SocketGuard rejects all
 * other tokens (including admin-only sessions) so admin and public
 * audiences stay isolated at the transport layer.
 *
 * Phase 1 scope (this PR): establish the auth layer + per-person room
 * topology. Phase 4 will publish personId-filtered live events into
 * these rooms (entry-list updates, matchUp schedule changes for a
 * Participant the user has claimed, etc.).
 */
import { SocketIoRealtimeAdapter } from '../realtime/socket-io-realtime.adapter';
import { extractHandshakeToken } from 'src/common/auth/extractHandshakeToken';
import { Audience } from '../../account/auth/decorators/audience.decorator';
import { audienceMatches } from '../../account/auth/guards/auth.guard';
import { SocketGuard } from '../../account/auth/guards/socket.guard';
import { Injectable, Logger, UseGuards } from '@nestjs/common';
import { verifyJwt } from 'src/common/auth/verifyJwt';
import { resolveCorsOrigins } from 'src/common/cors';
import { personChannel } from '../realtime/channels';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

@Injectable()
@WebSocketGateway({
  cors: { origin: resolveCorsOrigins(process.env.CFS_CORS_ORIGINS) },
  namespace: 'hiveid',
})
@UseGuards(SocketGuard)
@Audience(['hiveid'])
export class HiveIDGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  private readonly logger = new Logger(HiveIDGateway.name);

  @WebSocketServer()
  server?: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly realtime: SocketIoRealtimeAdapter,
  ) {}

  afterInit(server: Server): void {
    this.realtime.bind('hiveid', server);
  }

  /**
   * On connection: verify the handshake token here and auto-join the
   * per-person room, so personId-filtered broadcasts find this socket
   * without an explicit subscribe.
   *
   * This cannot rely on SocketGuard. Nest runs guards only around
   * `@SubscribeMessage` handlers, never around `handleConnection`, so
   * `client.data.user` is always empty at this point unless set here.
   * Until this was fixed the auto-join never happened and clients received
   * person updates only after calling `subscribePerson`.
   */
  async handleConnection(client: Socket): Promise<void> {
    const user = await this.authenticateConnection(client);
    const personId = user?.personId;
    if (typeof personId === 'string' && personId.length > 0) {
      await client.join(personChannel(personId).room);
      this.logger.log(`[connect] hiveid client ${client.id} joined person room ${personId}`);
    } else {
      this.logger.log(`[connect] hiveid client ${client.id} connected without a person link`);
    }
  }

  /**
   * The same checks SocketGuard applies — signature via `verifyJwt` and the
   * `hiveid` audience — run once at connect. On success the user is stamped
   * on `client.data.user`, where the guard would have put it. A connection
   * without a valid token is left connected and unjoined; every message it
   * sends still goes through SocketGuard and is rejected there.
   */
  private async authenticateConnection(client: Socket): Promise<any> {
    const token = extractHandshakeToken(client.handshake);
    if (!token) return undefined;
    try {
      const user = await verifyJwt(this.jwtService, token);
      if (!audienceMatches(user?.aud, ['hiveid'])) {
        this.logger.warn(`[connect] hiveid client ${client.id} presented a token without the hiveid audience`);
        return undefined;
      }
      client.data.user = user;
      return user;
    } catch (err) {
      this.logger.warn(`[connect] hiveid client ${client.id} token rejected: ${(err as Error)?.message ?? err}`);
      return undefined;
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`[disconnect] hiveid client ${client.id} disconnected`);
  }

  /**
   * Idempotent re-subscribe — useful after a personMerged event when the
   * client's cached personId rotates. The client supplies its current
   * personId; the gateway verifies it matches the JWT-attested personId
   * before joining the room (no cross-person eavesdropping).
   */
  @SubscribeMessage('subscribePerson')
  async subscribePerson(@ConnectedSocket() client: Socket): Promise<{ ok: boolean; personId?: string }> {
    const user = (client.data as any)?.user;
    const personId = user?.personId;
    if (typeof personId !== 'string' || personId.length === 0) {
      return { ok: false };
    }
    await client.join(personChannel(personId).room);
    return { ok: true, personId };
  }
}
