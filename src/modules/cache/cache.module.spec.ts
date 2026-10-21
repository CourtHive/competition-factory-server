import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import KeyvRedis from '@keyv/redis';
import Keyv from 'keyv';

import { KeyvStore } from './cache.module';

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
