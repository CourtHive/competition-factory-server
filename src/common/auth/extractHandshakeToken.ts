/**
 * The bearer token a socket client presented at handshake.
 *
 * Prefers `handshake.auth.token`: socket.io-client re-runs its `auth` callback
 * on every reconnect attempt, so this is the path that survives JWT rotation.
 * The Authorization header is baked in at initial connect and goes stale on
 * the first reconnect after a refresh (fixed for /hiveid socket clients on
 * 2026-06-01).
 *
 * Shared by `SocketGuard` (per message) and the gateways that authenticate at
 * connect time, so both read the token the same way.
 */
export function extractHandshakeToken(handshake: {
  auth?: unknown;
  headers?: { authorization?: string };
}): string | undefined {
  const authToken = (handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof authToken === 'string' && authToken.length > 0) return authToken;
  const [type, token] = handshake.headers?.authorization?.split(' ') ?? [];
  return type === 'Bearer' ? token : undefined;
}
