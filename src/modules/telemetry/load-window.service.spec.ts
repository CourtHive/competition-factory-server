import { observeShardCacheRead } from '../../storage/postgres/shardCacheObservation';
import { LoadWindowService } from './load-window.service';
import { withTournamentLock } from '../../services/tournamentMutex';
import { setTimeout as pause } from 'node:timers/promises';
import type { Pool } from 'pg';

it('measures callback and promise checkouts and contended acquisitions only inside the selected window', async () => {
  const connect = vi.fn((cb?) => (cb ? setTimeout(() => cb(null, {}, () => {}), 15) : pause(15, {})));
  const pool = { connect } as unknown as Pool;
  const service = new LoadWindowService(pool);
  const { windowId } = service.start();
  try {
    expect(() => service.start()).toThrow();
    expect(() => service.read('stale', true)).toThrow();
    await Promise.all([
      pool.connect(),
      new Promise<void>((done) => pool.connect(() => done())),
      withTournamentLock(['test'], () => pause(35)),
      withTournamentLock(['test'], () => pause(1)),
    ]);
    const result = service.read(windowId, false);
    expect(result.postgresPool.count).toBe(2);
    expect(result.postgresPool.p50).toBeGreaterThan(5);
    expect(result.tournamentLock.count).toBe(2);
    expect(result.tournamentLock.max).toBeGreaterThan(15);
    expect(result.eventLoop.count).toBeGreaterThan(0);
    const reset = service.reset(windowId);
    expect(service.read(reset.windowId, true).postgresPool).toEqual({ count: 0, p50: null, p99: null, max: null });
    expect(pool.connect).toBe(connect);
  } finally {
    service.onModuleDestroy();
  }
});

it('reports validated part reuse and transfers for the selected pool and window', () => {
  const pool = { connect: vi.fn() } as unknown as Pool;
  const other = { connect: vi.fn() } as unknown as Pool;
  const service = new LoadWindowService(pool);
  const reused = { shell: 1, draw: 2, participant: 3 };
  const transferred = { shell: 0, draw: 1, participant: 4 };
  const empty = { shell: 0, draw: 0, participant: 0 };
  observeShardCacheRead(pool, reused, transferred);
  const first = service.start();
  try {
    observeShardCacheRead(other, reused, transferred);
    observeShardCacheRead(pool, reused, transferred);
    const snapshot = service.read(first.windowId, false).shardCache;
    expect(snapshot).toEqual({ reads: 1, reused, transferred });
    observeShardCacheRead(pool, transferred, reused);
    expect(snapshot).toEqual({ reads: 1, reused, transferred });
    const second = service.reset(first.windowId);
    expect(service.read(second.windowId, true).shardCache).toEqual({ reads: 0, reused: empty, transferred: empty });
    observeShardCacheRead(pool, reused, transferred);
  } finally {
    service.onModuleDestroy();
  }
});
