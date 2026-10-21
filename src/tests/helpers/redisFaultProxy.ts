import net from 'node:net';

export type FaultMode = 'pass' | 'hang';

/**
 * A TCP proxy in front of Redis that a test can break on purpose:
 *
 * - `pass`: forwards to the upstream Redis.
 * - `hang`: accepts the socket and never answers. That is a black-holed route or a frozen Redis,
 *   the case a refused port cannot reproduce. No upstream is needed for this mode.
 * - `stop()`: closes the listener and every open socket. The port then refuses, as it does when
 *   Redis is down.
 * - `freeze()`: keeps the open sockets but stops forwarding on them. A connection that is up and
 *   has stopped answering.
 */
export class RedisFaultProxy {
  mode: FaultMode = 'pass';
  private server?: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private frozen = false;
  port = 0;

  constructor(private readonly upstream: { host: string; port: number } = { host: '127.0.0.1', port: 6379 }) {}

  get url(): string {
    return `redis://127.0.0.1:${this.port}`;
  }

  async start(port = this.port): Promise<void> {
    this.frozen = false;
    this.server = net.createServer((client) => this.accept(client));
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  async stop(): Promise<void> {
    this.dropConnections();
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  dropConnections(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  freeze(): void {
    this.frozen = true;
  }

  unfreeze(): void {
    this.frozen = false;
  }

  private accept(client: net.Socket): void {
    this.track(client);
    if (this.mode === 'hang') return;
    const upstream = net.connect(this.upstream.port, this.upstream.host);
    this.track(upstream);
    client.on('data', (chunk) => this.frozen || upstream.write(chunk));
    upstream.on('data', (chunk) => this.frozen || client.write(chunk));
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  }

  private track(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => this.sockets.delete(socket));
  }
}

/** Resolves to the promise's outcome, or to `'PENDING'` if it has not settled after `ms`. */
export async function settleWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ value?: T; error?: unknown; elapsedMs: number } | 'PENDING'> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Promise<'PENDING'>((resolve) => (timer = setTimeout(() => resolve('PENDING'), ms)));
  const settled = promise.then(
    (value) => ({ value, elapsedMs: Date.now() - started }),
    (error) => ({ error, elapsedMs: Date.now() - started }),
  );
  try {
    return await Promise.race([settled, pending]);
  } finally {
    clearTimeout(timer);
  }
}
