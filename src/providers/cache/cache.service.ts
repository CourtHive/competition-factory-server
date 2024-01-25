import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { RedisStore } from 'cache-manager-redis-store';
import { Inject, Injectable } from '@nestjs/common';
// import { Cache } from 'cache-manager';

@Injectable({})
export class CacheService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache & RedisStore) {}

  // private readonly logger = new Logger(CacheService.name);

  async get<T = unknown>(key: string) {
    return this.cache.get<T>(key);
  }

  async set(key: string, value: any, seconds = 600 /* 10min */) {
    console.log({ key, value, seconds });
    return this.cache.set(`${key}XoX`, value, { ttl: seconds }, null);
  }

  async del(key: string) {
    return this.cache.del(key);
  }
}
