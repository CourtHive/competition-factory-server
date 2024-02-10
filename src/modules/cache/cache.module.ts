import { CacheModule as CacheModule_, CacheModuleOptions } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import type { RedisClientOptions } from 'redis';
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const configCacheFactory = (config: ConfigService): CacheModuleOptions<RedisClientOptions> => {
  const redisConfig = config.get('redis');
  const url = redisConfig?.url || 'redis://127.0.0.1:6379';
  const ttl = redisConfig?.ttl || 60 * 60 * 24 * 7;

  return {
    store: () => redisStore({ ttl, url }),
    isGlobal: true,
    max: 10_000,
  };
};

@Global()
@Module({
  imports: [
    CacheModule_.registerAsync({
      useFactory: configCacheFactory,
      inject: [ConfigService],
      isGlobal: true,
    }),
  ],
})
export class CacheModule {}
