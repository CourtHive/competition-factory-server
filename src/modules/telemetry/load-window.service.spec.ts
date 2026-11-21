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
