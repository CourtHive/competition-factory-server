import { CacheModule as CacheModule_, CacheModuleOptions } from '@nestjs/cache-manager';
import { ConfigsModule } from 'src/config/config.module';
import { redisStore } from 'cache-manager-redis-yet';
import type { RedisClientOptions } from 'redis';
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const configCacheFactory = (config: ConfigService): CacheModuleOptions<RedisClientOptions> => {
  const redisConfig = config.get('redis');
  const url = redisConfig?.url || 'redis://127.0.0.1:6379';
  const ttl = redisConfig?.ttl;

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
      imports: [ConfigsModule],
      inject: [ConfigService],
      isGlobal: true,
    }),
  ],
})
export class CacheModule {}
