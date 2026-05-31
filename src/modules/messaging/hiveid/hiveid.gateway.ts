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
import { Injectable, Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { Audience } from '../../account/auth/decorators/audience.decorator';
import { SocketGuard } from '../../account/auth/guards/socket.guard';

const PERSON_ROOM_PREFIX = 'hiveid:person:';

@Injectable()
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'hiveid',
})
@UseGuards(SocketGuard)
@Audience(['hiveid'])
export class HiveIDGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(HiveIDGateway.name);

  @WebSocketServer()
  server?: Server;

  /**
   * On connection: the SocketGuard has already verified the JWT carries
   * `aud: 'hiveid'` and stamped the decoded payload on `client.data.user`.
   * Auto-join the per-person room so future personId-filtered broadcasts
   * find this socket without an explicit subscribe.
   */
  async handleConnection(client: Socket): Promise<void> {
    const user = (client.data as any)?.user;
    const personId = user?.personId;
    if (typeof personId === 'string' && personId.length > 0) {
      await client.join(PERSON_ROOM_PREFIX + personId);
      this.logger.log(`[connect] hiveid client ${client.id} joined person room ${personId}`);
    } else {
      this.logger.log(`[connect] hiveid client ${client.id} connected without a person link`);
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
    await client.join(PERSON_ROOM_PREFIX + personId);
    return { ok: true, personId };
  }

  /**
   * Phase-4 hook: broadcast a personId-scoped update to the matching
   * person room. Exposed so future PRs can wire callers (e.g. on
   * personMerged the survivor's room is notified to refresh `/me`).
   */
  broadcastPersonUpdate(personId: string, payload: any): void {
    if (!personId || !payload) return;
    this.server?.to(PERSON_ROOM_PREFIX + personId).emit('personUpdate', payload);
  }
}
