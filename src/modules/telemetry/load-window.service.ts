import { ConflictException, Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { createHistogram, monitorEventLoopDelay } from 'node:perf_hooks';
import { measureShardCache } from '../../storage/postgres/shardCacheObservation';
import { measureLockAcquisitions } from '../../services/tournamentMutex';
import { PG_POOL } from '../../storage/postgres/postgres.config';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

type Histogram = ReturnType<typeof createHistogram>;

function summarize(histogram: Pick<Histogram, 'count' | 'percentile' | 'max'>) {
  const ms = (n: number) => n / 1e6;
  const { count } = histogram;
  return {
    count,
    p50: count ? ms(histogram.percentile(50)) : null,
    p99: count ? ms(histogram.percentile(99)) : null,
    max: count ? ms(histogram.max) : null,
  };
}

// pg.Pool.query also uses this callback overload to acquire its client. Restore the
// instance's original method on close, so ordinary traffic pays no observer dispatch.
function measurePool(pool: Pool, histogram: Histogram) {
  const bound = pool.connect.bind(pool);
  const descriptor = Object.getOwnPropertyDescriptor(pool, 'connect');
  type Callback = Parameters<Pool['connect']>[0];
  pool.connect = function (callback?: Callback) {
    const start = process.hrtime.bigint();
    const record = () => histogram.record(process.hrtime.bigint() - start || BigInt(1));
    if (!callback) return bound().finally(record);
    return bound((err, client, release) => {
      record();
      callback(err, client, release);
    });
  } as Pool['connect'];
  return () => {
    if (descriptor) Object.defineProperty(pool, 'connect', descriptor);
    else Reflect.deleteProperty(pool, 'connect');
  };
}

function openWindow(pool: Pool) {
  const loop = monitorEventLoopDelay({ resolution: 10 });
  const lock = createHistogram();
  const pg = createHistogram();
  const restoreLock = measureLockAcquisitions((ns) => lock.record(ns || BigInt(1)));
  const restorePool = measurePool(pool, pg);
  const shardCache = measureShardCache(pool);
  const startedAt = new Date().toISOString();
  loop.enable();
  return {
    windowId: randomUUID(),
    startedAt,
    loop,
    lock,
    pg,
    shardCache,
    close() {
      shardCache.close();
      loop.disable();
      restorePool();
      restoreLock();
    },
  };
}

@Injectable()
export class LoadWindowService implements OnModuleDestroy {
  private active?: ReturnType<typeof openWindow>;
  private expiry?: ReturnType<typeof setTimeout>;
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  start() {
    if (this.active) throw new ConflictException('Measurement window already open');
    this.active = openWindow(this.pool);
    this.expiry = setTimeout(() => this.close(), 60 * 60_000).unref();
    return { pid: process.pid, windowId: this.active.windowId, startedAt: this.active.startedAt };
  }

  read(id: string, stop: boolean) {
    const w = this.active;
    if (!w || w.windowId !== id) throw new ConflictException('Measurement window is not active on this process');
    const endedAt = new Date().toISOString();
    if (stop) this.close();
    return {
      pid: process.pid,
      windowId: w.windowId,
      startedAt: w.startedAt,
      endedAt,
      unit: 'ms',
      resolutionMs: 10,
      eventLoop: summarize(w.loop),
      tournamentLock: summarize(w.lock),
      postgresPool: summarize(w.pg),
      shardCache: w.shardCache.snapshot(),
    };
  }

  reset(id: string) {
    this.read(id, true);
    return this.start();
  }

  private close() {
    clearTimeout(this.expiry);
    this.active?.close();
    this.active = undefined;
  }

  onModuleDestroy() {
    this.close();
  }
}
