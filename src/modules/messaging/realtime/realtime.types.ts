/**
 * The realtime port: what the server needs from a push transport, with no
 * Socket.IO types in it. Socket.IO is the only implementation today
 * (`SocketIoRealtimeAdapter`); a managed pub/sub service (AWS AppSync Events,
 * API Gateway WebSocket, IoT Core) would be a second one.
 *
 * Domain code publishes through `REALTIME_PUBLISHER` and reads presence
 * through `REALTIME_PRESENCE`. Only the gateways — which ARE the Socket.IO
 * inbound adapter — touch `socket.io` directly.
 *
 * See Mentat/planning/REALTIME_TRANSPORT_PLUGGABILITY.md.
 */

export const REALTIME_PUBLISHER = Symbol('REALTIME_PUBLISHER');
export const REALTIME_PRESENCE = Symbol('REALTIME_PRESENCE');

/** The three client-facing surfaces. Each maps to a Socket.IO namespace today. */
export type RealtimeNamespace = 'tmx' | 'public' | 'hiveid';

/**
 * Where an event is delivered: a namespace plus a room within it. Room names
 * are built only by the helpers in `channels.ts`, so the topic scheme a second
 * transport has to mirror lives in one file.
 */
export interface RealtimeChannel {
  namespace: RealtimeNamespace;
  room: string;
}

export interface PublishOptions {
  /**
   * A connection that must NOT receive the event — the originator, which
   * already has its own reply. Transports without server-side exclusion can
   * ignore it, provided the payload carries an origin marker the client
   * filters on (`originClientId` on `tournamentMutation`).
   */
  excludeConnectionId?: string;
}

export interface RealtimePublisher {
  /**
   * Deliver `event` with `payload` to every connection subscribed to
   * `channel`. Fire-and-forget. Returns false when the transport could not
   * attempt delivery (e.g. the namespace is not bound yet); the
   * implementation is responsible for surfacing that (A2), so callers need
   * not log it again.
   */
  publish(channel: RealtimeChannel, event: string, payload: unknown, options?: PublishOptions): boolean;
}

/** One live connection in a room. */
export interface PresenceMember {
  connectionId: string;
  /** The JWT-verified user attached to the connection, when it authenticated. */
  user?: Record<string, any>;
  /** Epoch ms at which the connection joined THIS room, when recorded. */
  joinedAt?: number;
}

export interface RealtimePresence {
  /** Connections currently in `channel`. Empty when the namespace is unbound. */
  members(channel: RealtimeChannel): Promise<PresenceMember[]>;
  /** Rooms in `namespace` whose name starts with `prefix`. Empty when the namespace is unbound. */
  rooms(namespace: RealtimeNamespace, prefix: string): Promise<string[]>;
}
