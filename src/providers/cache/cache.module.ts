import { CacheModule as CacheModule_ } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-store';
import { Module, Global } from '@nestjs/common';
// import { CacheService } from './cache.service';
import { ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    CacheModule_.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        isGlobal: true,
        max: 10_000,
        store: (): any =>
          redisStore({
            socket: {
              host: config.getOrThrow('redis').host || 'localhost',
              port: config.getOrThrow('redis').port || 6379,
            },
          }),
      }),
    }),
  ],
  // exports: [CacheService],
  // providers: [CacheService],
})
export class CacheModule {}
