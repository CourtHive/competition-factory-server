import { CacheModule as CacheModule_ } from '@nestjs/cache-manager';
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
      useFactory: (store: KeyvStore) => ({
        stores: [store.keyv],
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
