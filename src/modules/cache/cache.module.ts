import { CacheModule as CacheModule_, type CacheModuleOptions } from '@nestjs/cache-manager';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { Module, Global, Logger, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Class-provider so Nest invokes onModuleDestroy on app.close(); a useFactory
// returning a Keyv directly leaves the Redis socket open (Jest force-exits).
@Injectable()
export class KeyvStore implements OnModuleDestroy {
  readonly keyv: Keyv;
  constructor(config: ConfigService) {
    const redisConfig = config.get('redis');
    const url = redisConfig?.url || 'redis://127.0.0.1:6379';
    const ttl = redisConfig?.ttl || 60 * 60 * 24 * 7 * 1000; // milliseconds
    this.keyv = new Keyv({ store: new KeyvRedis(url), ttl });
    this.keyv.on('error', (err: unknown) => this.reportError(err));
  }

  // keyv 6 behaves like a Node EventEmitter: an 'error' with no listener THROWS. @keyv/redis
  // re-emits the Redis client's connection errors through Keyv, and a dropped connection fires
  // from inside node-redis's socket handler, where nothing can catch it — so without this
  // listener a Redis restart takes the whole server down ("Uncaught: Socket closed
  // unexpectedly", measured). keyv 5 dropped those events silently and the process survived;
  // this listener restores that survival, and logs instead of staying silent (architectural
  // standard A2 — fail-soft must surface).
  //
  // node-redis keeps reconnecting while Redis is away and every failed attempt is another
  // 'error', so the log is throttled: the first error is reported at once, later ones are
  // counted and summarised at most once per ERROR_LOG_INTERVAL_MS.
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
    const message = err instanceof Error ? err.message : String(err);
    const suppressed = this.suppressedErrors ? ` (${this.suppressedErrors} more since the last report)` : '';
    this.logger.error(
      `Redis cache error: ${message}${suppressed}. Cache reads and writes are degraded; ` +
        'repeated reports mean Redis is restarting or unreachable.',
    );
    this.lastErrorLoggedAt = now;
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
