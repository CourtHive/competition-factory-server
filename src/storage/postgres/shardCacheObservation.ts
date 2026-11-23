import type { Pool } from 'pg';

interface PartCounts {
  shell: number;
  draw: number;
  participant: number;
}

const emptyCounts = (): PartCounts => ({ shell: 0, draw: 0, participant: 0 });

type ObserveRead = (reused: PartCounts, transferred: PartCounts) => void;
const windows = new WeakMap<Pool, ObserveRead>();

/** Capture the pool's current observer immediately before starting the SELECT. */
export function shardCacheReadObserver(pool: Pool) {
  return windows.get(pool);
}

export function measureShardCache(pool: Pool) {
  const counts = { reads: 0, reused: emptyCounts(), transferred: emptyCounts() };
  const observe: ObserveRead = (reused, transferred) => {
    if (windows.get(pool) !== observe) return;
    counts.reads++;
    for (const part of ['shell', 'draw', 'participant'] as const) {
      counts.reused[part] += reused[part];
      counts.transferred[part] += transferred[part];
    }
  };
  windows.set(pool, observe);
  return {
    snapshot: () => ({ reads: counts.reads, reused: { ...counts.reused }, transferred: { ...counts.transferred } }),
    close: () => {
      if (windows.get(pool) === observe) windows.delete(pool);
    },
  };
}
