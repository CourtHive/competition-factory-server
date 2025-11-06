import { CacheModule as CacheModule_, CacheModuleOptions } from '@nestjs/cache-manager';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const configCacheFactory = (config: ConfigService): CacheModuleOptions => {
  const redisConfig = config.get('redis');
  const url = redisConfig?.url || 'redis://127.0.0.1:6379';
  const ttl = redisConfig?.ttl || 60 * 60 * 24 * 7 * 1000; // milliseconds

  return {
    stores: [new Keyv({ store: new KeyvRedis(url), ttl })],
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
