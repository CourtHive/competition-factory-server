import { RedisFaultProxy, settleWithin } from 'src/tests/helpers/redisFaultProxy';
import { ConfigService } from '@nestjs/config';
import { createCache } from 'cache-manager';
import { Logger } from '@nestjs/common';

import { KeyvStore } from './cache.module';

// Needs a live Redis (CI's service container, or the local one). The proxy sits between
// KeyvStore and that Redis so a test can take Redis away and bring it back.
const upstream = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
const db = upstream.pathname.replace('/', '') || '0';

const BOUNDS = { connectTimeoutMs: 300, commandTimeoutMs: 300, retryAfterMs: 1_000 };
// A whole operation is bounded by connect + command.
const OP_BOUND_MS = BOUNDS.connectTimeoutMs + BOUNDS.commandTimeoutMs;
const SLACK_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('KeyvStore through a Redis outage', () => {
  let proxy: RedisFaultProxy;
  let store: KeyvStore;
  let unhandled: unknown[];
  let recovered: string[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    recovered = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((message: any) => {
      recovered.push(String(message));
    });
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
    proxy = new RedisFaultProxy({ host: upstream.hostname, port: Number(upstream.port) || 6379 });
    await proxy.start();
    const config = { get: () => ({ url: `${proxy.url}/${db}`, ...BOUNDS }) } as unknown as ConfigService;
    store = new KeyvStore(config);
  });

  afterEach(async () => {
    process.off('unhandledRejection', onUnhandled);
    await store.keyv.delete('outage-probe').catch(() => undefined);
    await store.onModuleDestroy().catch(() => undefined);
    await proxy.stop();
    vi.restoreAllMocks();
  });

  it('survives Redis going away, reads misses within the bound, and recovers when it returns', async () => {
    const cache = createCache({ stores: [store.keyv as any] });
    await cache.set('outage-probe', { written: 'before' });
    expect(await cache.get('outage-probe')).toEqual({ written: 'before' });

    const port = proxy.port;
    await proxy.stop(); // Redis is gone: open sockets dropped, the port refuses

    const during = await settleWithin(cache.get('outage-probe'), BOUNDS.connectTimeoutMs + SLACK_MS);
    expect(during).not.toBe('PENDING');
    expect(during).toMatchObject({ value: undefined });
    const write = await settleWithin(
      cache.set('outage-probe', { written: 'during' }),
      BOUNDS.connectTimeoutMs + SLACK_MS,
    );
    expect(write).not.toBe('PENDING');
    expect(write !== 'PENDING' && write.error).toBeUndefined();

    await proxy.start(port); // Redis is back
    await sleep(BOUNDS.retryAfterMs + 100); // past the cool-down

    // The value written before the outage is still in Redis, so a hit proves the reconnect.
    expect(await cache.get('outage-probe')).toEqual({ written: 'before' });
    expect(recovered.some((line) => line.includes('Redis cache reconnected'))).toBe(true);
    expect(unhandled).toEqual([]);
  });

  it('a connection that stops answering fails the command within the bound and then recovers', async () => {
    const cache = createCache({ stores: [store.keyv as any] });
    await cache.set('outage-probe', 1);

    proxy.freeze(); // sockets stay open, nothing comes back
    const frozen = await settleWithin(cache.get('outage-probe'), OP_BOUND_MS + SLACK_MS);
    expect(frozen).not.toBe('PENDING');
    expect(frozen).toMatchObject({ value: undefined });
    expect(store.adapter.bypassed).toBe(true);

    proxy.unfreeze();
    await sleep(BOUNDS.retryAfterMs + 100);
    expect(await cache.get('outage-probe')).toBe(1);
    expect(unhandled).toEqual([]);
  });
});
