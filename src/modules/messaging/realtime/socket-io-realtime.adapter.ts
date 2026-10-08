import { Injectable, Logger } from '@nestjs/common';

import type { Namespace, Server, Socket } from 'socket.io';
import type {
  PresenceMember,
  PublishOptions,
  RealtimeChannel,
  RealtimeNamespace,
  RealtimePresence,
  RealtimePublisher,
} from './realtime.types';

/** Per-connection map of room → epoch ms joined, written by the gateways via `recordRoomJoin`. */
const ROOM_JOINED_AT = 'roomJoinedAt';

/** Start a connection with no recorded room joins. */
export function initRoomJoins(socket: Socket): void {
  socket.data[ROOM_JOINED_AT] = {};
}

/** Stamp the moment `socket` joined `room`, so presence can report it. */
export function recordRoomJoin(socket: Socket, room: string): void {
  socket.data[ROOM_JOINED_AT] ??= {};
  socket.data[ROOM_JOINED_AT][room] = Date.now();
}

/**
 * Socket.IO implementation of the realtime port. Each gateway binds its
 * namespace in `afterInit`; until then a publish to that namespace cannot be
 * attempted, and is counted and logged rather than dropped silently (A2).
 *
 * Nest injects a `Namespace` into a namespaced gateway's `@WebSocketServer()`
 * even though the property is typed `Server`, so `bind` accepts either and
 * treats the value as a `Namespace`.
 */
@Injectable()
export class SocketIoRealtimeAdapter implements RealtimePublisher, RealtimePresence {
  private readonly logger = new Logger(SocketIoRealtimeAdapter.name);
  private readonly namespaces = new Map<RealtimeNamespace, Namespace>();
  private readonly droppedCounts = new Map<RealtimeNamespace, number>();

  bind(namespace: RealtimeNamespace, server: Server | Namespace): void {
    this.namespaces.set(namespace, server as Namespace);
    this.logger.log(`[realtime] /${namespace} bound`);
  }

  publish(channel: RealtimeChannel, event: string, payload: unknown, options?: PublishOptions): boolean {
    const nsp = this.namespaces.get(channel.namespace);
    if (!nsp) {
      this.recordDrop(channel, event);
      return false;
    }
    this.recordRecovery(channel.namespace);

    const target = options?.excludeConnectionId
      ? nsp.to(channel.room).except(options.excludeConnectionId)
      : nsp.to(channel.room);
    target.emit(event, payload);
    return true;
  }

  async members(channel: RealtimeChannel): Promise<PresenceMember[]> {
    const nsp = this.namespaces.get(channel.namespace);
    if (!nsp) return [];
    const sockets = await nsp.in(channel.room).fetchSockets();
    return sockets.map((s) => ({
      connectionId: s.id,
      user: s.data?.user,
      joinedAt: s.data?.[ROOM_JOINED_AT]?.[channel.room],
    }));
  }

  async rooms(namespace: RealtimeNamespace, prefix: string): Promise<string[]> {
    const nsp = this.namespaces.get(namespace);
    if (!nsp) return [];
    return [...nsp.adapter.rooms.keys()].filter((room) => room.startsWith(prefix));
  }

  // Throttled like AuditService.recordFailure: the first drop, then 10/100/1000, then every 50th.
  private recordDrop(channel: RealtimeChannel, event: string): void {
    const count = (this.droppedCounts.get(channel.namespace) ?? 0) + 1;
    this.droppedCounts.set(channel.namespace, count);
    const isMilestone = count === 1 || count === 10 || count === 100 || count === 1000 || count % 50 === 0;
    if (isMilestone) {
      this.logger.warn(
        `[realtime] ${event} to ${channel.room} dropped — /${channel.namespace} not bound (pre-bootstrap or mid-shutdown) (${count}x)`,
      );
    }
  }

  private recordRecovery(namespace: RealtimeNamespace): void {
    const previous = this.droppedCounts.get(namespace);
    if (!previous) return;
    this.droppedCounts.delete(namespace);
    this.logger.warn(`[realtime] /${namespace} publishing again after ${previous} dropped event(s)`);
  }
}
