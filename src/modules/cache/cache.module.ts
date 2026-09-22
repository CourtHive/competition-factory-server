import { CacheModule as CacheModule_, type CacheModuleOptions } from '@nestjs/cache-manager';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { Module, Global, Injectable, OnModuleDestroy } from '@nestjs/common';
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
