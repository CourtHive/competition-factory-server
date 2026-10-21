import { RedisFaultProxy, settleWithin } from 'src/tests/helpers/redisFaultProxy';
import { CACHE_BYPASSED_MESSAGE, KeyvStore } from './cache.module';
import { ConfigService } from '@nestjs/config';
import redisConfig from 'src/config/cache/redis';
import { createCache } from 'cache-manager';
import { Logger } from '@nestjs/common';
import KeyvRedis from '@keyv/redis';
import Keyv from 'keyv';

// Nothing listens on port 1, and KeyvRedis connects lazily, so no test here opens a socket.
const config = { get: () => ({ url: 'redis://127.0.0.1:1' }) } as unknown as ConfigService;

describe('KeyvStore error handling', () => {
  let logged: string[];
  let spy: any;

  beforeEach(() => {
    logged = [];
    spy = vi.spyOn(Logger.prototype, 'error').mockImplementation((message: any) => {
      logged.push(String(message));
    });
  });

  afterEach(() => {
    spy.mockRestore();
    vi.useRealTimers();
  });

  // The control comes first: without it the next test asserts only that nothing threw, which a
  // keyv that silently drops errors (keyv 5) would also satisfy.
  it('CONTROL: a keyv 6 instance with no error listener throws on an error event — this is what kills the process', () => {
    const bare = new Keyv({ store: new KeyvRedis('redis://127.0.0.1:1') });
    expect(() => bare.emit('error', new Error('Socket closed unexpectedly'))).toThrow('Socket closed unexpectedly');
  });

  it('survives an error event and reports it', () => {
    const store = new KeyvStore(config);
    expect(() => store.keyv.emit('error', new Error('Socket closed unexpectedly'))).not.toThrow();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('Redis cache error: Socket closed unexpectedly');
  });

  it('throttles a reconnect storm and counts what it suppressed', () => {
    vi.useFakeTimers();
    const store = new KeyvStore(config);
    for (let i = 0; i < 5; i++) store.keyv.emit('error', new Error('connect ECONNREFUSED'));
    expect(logged).toHaveLength(1);

    vi.advanceTimersByTime(KeyvStore.ERROR_LOG_INTERVAL_MS);
    store.keyv.emit('error', new Error('connect ECONNREFUSED'));
    expect(logged).toHaveLength(2);
    expect(logged[1]).toContain('(4 more since the last report)');
  });

  it('applies the configured default ttl', () => {
    const store = new KeyvStore({ get: () => ({ url: 'redis://127.0.0.1:1', ttl: 1234 }) } as unknown as ConfigService);
    expect(store.keyv.ttl).toBe(1234);
  });
});

// Bounds kept small so the suite stays fast; the production defaults are CACHE_REDIS_DEFAULTS.
const BOUNDS = { connectTimeoutMs: 300, commandTimeoutMs: 300, retryAfterMs: 1_000 };
// Scheduling slack on top of a bound before a call counts as hung.
const SLACK_MS = 400;

const boundedConfig = (url: string) => ({ get: () => ({ url, ...BOUNDS }) }) as unknown as ConfigService;

// The same call path the server uses: cache-manager over KeyvStore's Keyv.
const cacheOver = (store: KeyvStore) => createCache({ stores: [store.keyv as any] });

describe('KeyvStore with Redis unreachable', () => {
  let proxy: RedisFaultProxy;
  let store: KeyvStore | undefined;
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
    proxy = new RedisFaultProxy();
    await proxy.start();
  });

  afterEach(async () => {
    process.off('unhandledRejection', onUnhandled);
    await store?.onModuleDestroy().catch(() => undefined);
    store = undefined;
    await proxy.stop();
    vi.restoreAllMocks();
  });

  // Without this control the tests below could pass against a client that was never at risk of
  // hanging. It is the configuration the server shipped with: a bare KeyvRedis(url).
  it('CONTROL: an unbounded adapter leaves cache.get pending while the peer never answers', async () => {
    proxy.mode = 'hang';
    const adapter = new KeyvRedis(proxy.url);
    const keyv = new Keyv({ store: adapter });
    keyv.on('error', () => undefined);
    const outcome = await settleWithin(createCache({ stores: [keyv as any] }).get('k'), 1_500);
    expect(outcome).toBe('PENDING');
    try {
      (adapter.client as any).destroy();
    } catch {
      // never opened
    }
  });

  it('a refused port reads as a miss, and set/del resolve, within the connect bound', async () => {
    const url = proxy.url;
    await proxy.stop(); // the port now refuses
    store = new KeyvStore(boundedConfig(url));
    const cache = cacheOver(store);

    const get = await settleWithin(cache.get('k'), BOUNDS.connectTimeoutMs + SLACK_MS);
    expect(get).not.toBe('PENDING');
    expect(get).toMatchObject({ value: undefined });
    expect(get !== 'PENDING' && get.error).toBeUndefined();

    for (const call of [cache.set('k', 1), cache.del('k')] as Promise<unknown>[]) {
      const outcome = await settleWithin(call, BOUNDS.connectTimeoutMs + SLACK_MS);
      expect(outcome).not.toBe('PENDING');
      expect(outcome !== 'PENDING' && outcome.error).toBeUndefined();
    }
    expect(unhandled).toEqual([]);
  });

  it('a peer that never answers reads as a miss within the connect bound, then is skipped during the cool-down', async () => {
    proxy.mode = 'hang';
    store = new KeyvStore(boundedConfig(proxy.url));
    const cache = cacheOver(store);

    const first = await settleWithin(cache.get('k'), BOUNDS.connectTimeoutMs + SLACK_MS);
    expect(first).not.toBe('PENDING');
    expect(first).toMatchObject({ value: undefined });

    // Inside the cool-down the cache does not touch Redis at all.
    expect(store.adapter.bypassed).toBe(true);
    const second = await settleWithin(cache.get('k'), 100);
    expect(second).not.toBe('PENDING');
    expect(second).toMatchObject({ value: undefined });
    const set = await settleWithin(cache.set('k', 1), 100);
    expect(set).not.toBe('PENDING');
    expect(set !== 'PENDING' && set.error).toBeUndefined();
    expect(unhandled).toEqual([]);
  });

  it('reports the outage through the throttled logger', async () => {
    const logged: string[] = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((message: any) => {
      logged.push(String(message));
    });
    proxy.mode = 'hang';
    store = new KeyvStore(boundedConfig(proxy.url));
    const cache = cacheOver(store);
    await cache.get('k');
    await cache.get('k');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('Redis cache error');
    expect(logged[0]).not.toContain(CACHE_BYPASSED_MESSAGE); // the first report names the real failure
  });
});

describe('redis config', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  // keyv 6 stores a key with NO expiry when `ttl` is a string (keyv 5 coerced it), and REDIS_TTL
  // arrives from the environment as one.
  it('parses REDIS_TTL and the bounds as numbers', () => {
    process.env.REDIS_TTL = '28800000';
    process.env.REDIS_CONNECT_TIMEOUT_MS = '750';
    const { redis } = redisConfig();
    expect(redis.ttl).toBe(28_800_000);
    expect(redis.connectTimeoutMs).toBe(750);
  });

  it('leaves unset or unparsable values to the defaults', () => {
    delete process.env.REDIS_TTL;
    process.env.REDIS_COMMAND_TIMEOUT_MS = 'soon';
    const { redis } = redisConfig();
    expect(redis.ttl).toBeUndefined();
    expect(redis.commandTimeoutMs).toBeUndefined();
  });
});
