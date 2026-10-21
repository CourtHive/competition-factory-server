import { CacheModule as CacheModule_, type CacheModuleOptions } from '@nestjs/cache-manager';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { Module, Global, Logger, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const CACHE_REDIS_DEFAULTS = {
  ttlMs: 60 * 60 * 24 * 7 * 1000,
  connectTimeoutMs: 1_000,
  commandTimeoutMs: 2_000,
  retryAfterMs: 5_000,
};

export const CACHE_BYPASSED_MESSAGE = 'Redis cache bypassed: the last connect or command failed';

type Bounds = { connectTimeoutMs: number; commandTimeoutMs: number; retryAfterMs: number };

/**
 * The cache is an optimisation, so a Redis outage must read as a cache MISS, never as a hung
 * request. Out of the box it hangs. node-redis retries a failed connect forever and parks every
 * command in its offline queue until one succeeds, so `cache.get()` never settles while Redis is
 * down (measured: still pending after 8s, both for a refused port and for a peer that accepts the
 * socket and never answers). Three bounds fix that:
 *
 * 1. `connectionTimeout` on the adapter. @keyv/redis then races each connect against it. On
 *    failure it swaps the client for a fresh one, and it turns node-redis's background reconnect
 *    off (`reconnectStrategy: false`). Reconnecting happens on demand instead: the next cache call
 *    after the cool-down below makes the attempt, so the cache recovers by itself when Redis
 *    returns. `disableOfflineQueue` makes a command on a not-ready client fail at once instead of
 *    waiting in a queue.
 * 2. A bound on each whole operation (connect plus command). node-redis's own
 *    `commandOptions.timeout` does not cover this case. It stops counting once a command is
 *    written to the socket, so a connection that is up but has stopped answering (a frozen Redis,
 *    a half-open route) leaves the reply pending forever (measured). After the bound the operation
 *    returns keyv's fallback and the client is destroyed. That rejects the stranded command, and
 *    a reply arriving late cannot put the next command's reply out of step.
 * 3. A cool-down (`retryAfterMs`). After a failed connect or a timed-out operation, cache calls
 *    skip Redis entirely for that long. Without it, every request during a black-holed outage would
 *    pay the full timeout. With it, at most one call per window does.
 *
 * `throwOnConnectError: false` plus the Keyv error listener in KeyvStore turn every failure into
 * keyv's fallback (`undefined` for a get), and each failure is reported through the throttled
 * logger.
 */
export class BoundedKeyvRedis extends KeyvRedis<any> {
  /** Emitted the first time a client is ready again after any error. */
  static readonly RECOVERED = 'recovered';
  private readonly bounds: Bounds;
  private unavailableUntil = 0;
  private failedSinceReady = false;

  constructor(url: string, bounds: Bounds) {
    super(
      {
        url,
        disableOfflineQueue: true,
        socket: { connectTimeout: bounds.connectTimeoutMs, reconnectStrategy: false },
      },
      { connectionTimeout: bounds.connectTimeoutMs, throwOnConnectError: false },
    );
    this.bounds = bounds;
    this.on('error', () => {
      this.failedSinceReady = true;
    });
  }

  get bypassed(): boolean {
    return Date.now() < this.unavailableUntil;
  }

  override async getClient(): Promise<any> {
    if (this.bypassed) throw new Error(CACHE_BYPASSED_MESSAGE);
    const client: any = await super.getClient();
    if (!client.isReady) {
      this.trip();
    } else if (this.failedSinceReady) {
      // 'ready', not the adapter's 'connect': 'connect' fires on the TCP connect, before a
      // handshake that may still hang.
      this.failedSinceReady = false;
      this.emit(BoundedKeyvRedis.RECOVERED);
    }
    return client;
  }

  override get<U = any>(key: string): Promise<U | undefined> {
    return this.bounded(super.get<U>(key), undefined);
  }
  override getMany<U = any>(keys: string[]): Promise<Array<U | undefined>> {
    return this.bounded(
      super.getMany<U>(keys),
      keys.map(() => undefined),
    );
  }
  override set(key: string, value: string, expires?: number): Promise<boolean> {
    return this.bounded(super.set(key, value, expires), false);
  }
  override setMany<Value>(entries: Parameters<KeyvRedis<any>['setMany']>[0]): Promise<boolean[]> {
    return this.bounded(
      super.setMany<Value>(entries as any),
      entries.map(() => false),
    );
  }
  override has(key: string): Promise<boolean> {
    return this.bounded(super.has(key), false);
  }
  override delete(key: string): Promise<boolean> {
    return this.bounded(super.delete(key), false);
  }
  override deleteMany(keys: string[]): Promise<boolean[]> {
    return this.bounded(
      super.deleteMany(keys),
      keys.map(() => false),
    );
  }

  private bounded<R>(operation: Promise<R>, fallback: R): Promise<R> {
    const limitMs = this.bounds.connectTimeoutMs + this.bounds.commandTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<R>((resolve) => {
      timer = setTimeout(() => {
        this.trip();
        this.destroyClient();
        this.emit('error', new Error(`Redis cache operation timed out after ${limitMs}ms`));
        resolve(fallback);
      }, limitMs);
    });
    // The losing side of the race still settles later, and a rejection there must not be unhandled.
    operation.catch(() => undefined);
    return Promise.race([operation, timedOut]).finally(() => clearTimeout(timer));
  }

  private destroyClient(): void {
    try {
      (this.client as any).destroy();
    } catch {
      // never opened, or already closed
    }
  }

  private trip(): void {
    this.failedSinceReady = true;
    this.unavailableUntil = Date.now() + this.bounds.retryAfterMs;
  }
}

// Class-provider so Nest invokes onModuleDestroy on app.close(); a useFactory
// returning a Keyv directly leaves the Redis socket open (Jest force-exits).
@Injectable()
export class KeyvStore implements OnModuleDestroy {
  readonly keyv: Keyv;
  readonly adapter: BoundedKeyvRedis;
  constructor(config: ConfigService) {
    const redisConfig = config.get('redis');
    const url = redisConfig?.url || 'redis://127.0.0.1:6379';
    const ttl = redisConfig?.ttl || CACHE_REDIS_DEFAULTS.ttlMs; // milliseconds
    this.adapter = new BoundedKeyvRedis(url, {
      connectTimeoutMs: redisConfig?.connectTimeoutMs || CACHE_REDIS_DEFAULTS.connectTimeoutMs,
      commandTimeoutMs: redisConfig?.commandTimeoutMs || CACHE_REDIS_DEFAULTS.commandTimeoutMs,
      retryAfterMs: redisConfig?.retryAfterMs || CACHE_REDIS_DEFAULTS.retryAfterMs,
    });
    this.keyv = new Keyv({ store: this.adapter, ttl });
    this.keyv.on('error', (err: unknown) => this.reportError(err));
    this.adapter.on(BoundedKeyvRedis.RECOVERED, () => this.reportRecovery());
  }

  // keyv 6 behaves like a Node EventEmitter: an 'error' with no listener THROWS. @keyv/redis
  // re-emits the Redis client's connection errors through Keyv, and a dropped connection fires
  // from inside node-redis's socket handler, where nothing can catch it — so without this
  // listener a Redis restart takes the whole server down ("Uncaught: Socket closed
  // unexpectedly", measured). keyv 5 dropped those events silently and the process survived;
  // this listener restores that survival, and logs instead of staying silent (architectural
  // standard A2 — fail-soft must surface).
  //
  // While Redis is away every cache call that fails or is bypassed is another 'error', so the log
  // is throttled: the first error is reported at once, later ones are counted and summarised at
  // most once per ERROR_LOG_INTERVAL_MS. A reconnect after a reported error is logged too, so the
  // outage has an end in the log as well as a start.
  static readonly ERROR_LOG_INTERVAL_MS = 60_000;
  private readonly logger = new Logger('KeyvStore');
  private lastErrorLoggedAt = 0;
  private suppressedErrors = 0;

  private reportError(err: unknown): void {
    const now = Date.now();
    if (this.lastErrorLoggedAt && now - this.lastErrorLoggedAt < KeyvStore.ERROR_LOG_INTERVAL_MS) {
      this.suppressedErrors += 1;
      return;
    }
    // node-redis's command TimeoutError has an empty message, so fall back to its class name.
    const message = err instanceof Error ? err.message || err.constructor.name : String(err);
    const suppressed = this.suppressedErrors ? ` (${this.suppressedErrors} more since the last report)` : '';
    this.logger.error(
      `Redis cache error: ${message}${suppressed}. Cache reads and writes are degraded; ` +
        'repeated reports mean Redis is restarting or unreachable.',
    );
    this.lastErrorLoggedAt = now;
    this.suppressedErrors = 0;
    this.degraded = true;
  }

  private degraded = false;

  private reportRecovery(): void {
    if (!this.degraded) return;
    const suppressed = this.suppressedErrors ? ` (${this.suppressedErrors} errors since the last report)` : '';
    this.logger.log(`Redis cache reconnected${suppressed}; cache reads and writes resumed.`);
    this.degraded = false;
    this.lastErrorLoggedAt = 0;
    this.suppressedErrors = 0;
  }
  async onModuleDestroy(): Promise<void> {
    await this.keyv.disconnect();
  }
}

@Global()
@Module({
  imports: [
    CacheModule_.registerAsync({
      // `stores` is typed against @nestjs/cache-manager's OWN view of Keyv, not ours.
      //
      // keyv ships two declaration files — `index.d.cts` for the `require` condition and
      // `index.d.ts` for `import`. This project compiles as commonjs under node10 resolution, so our
      // `Keyv` and the one inside `@nestjs/cache-manager/dist/index.d.ts` can be loaded from the
      // same path yet remain nominally unrelated: "Two different types with this name exist, but
      // they are unrelated." Same version, same file on disk, two identities.
      //
      // Taking the element type from `CacheModuleOptions` conforms to the consumer's declaration
      // instead of asserting our own, so the cast is confined to one boundary and disappears the day
      // keyv ships a single declaration or this project moves to node16 resolution.
      useFactory: (store: KeyvStore): CacheModuleOptions => ({
        stores: [store.keyv] as unknown as CacheModuleOptions['stores'],
        isGlobal: true,
        max: 10_000,
      }),
      inject: [KeyvStore],
      extraProviders: [KeyvStore],
      isGlobal: true,
    }),
  ],
  providers: [KeyvStore],
  exports: [KeyvStore],
})
export class CacheModule {}
