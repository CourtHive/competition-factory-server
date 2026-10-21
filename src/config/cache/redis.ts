// Numbers are parsed here, not at the call site: keyv 6 treats a string `ttl` as no TTL at all
// (measured — REDIS_TTL='28800000' wrote keys with PTTL -1, where keyv 5 had coerced it).
export default () => ({
  redis: {
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    url: process.env.REDIS_URL,
    ttl: Number(process.env.REDIS_TTL) || undefined,
    // Bounds on the cache's Redis client so an outage degrades to cache misses instead of hung
    // requests. See KeyvStore in src/modules/cache/cache.module.ts.
    connectTimeoutMs: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || undefined,
    commandTimeoutMs: Number(process.env.REDIS_COMMAND_TIMEOUT_MS) || undefined,
    retryAfterMs: Number(process.env.REDIS_RETRY_AFTER_MS) || undefined,
  },
});
