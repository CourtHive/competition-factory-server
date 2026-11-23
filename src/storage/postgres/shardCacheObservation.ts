import type { Pool } from 'pg';

interface PartCounts {
  shell: number;
  draw: number;
  participant: number;
}

const emptyCounts = (): PartCounts => ({ shell: 0, draw: 0, participant: 0 });

const windows = new WeakMap<Pool, { reads: number; reused: PartCounts; transferred: PartCounts }>();

export function measureShardCache(pool: Pool) {
  const counts = { reads: 0, reused: emptyCounts(), transferred: emptyCounts() };
  windows.set(pool, counts);
  return {
    snapshot: () => ({ reads: counts.reads, reused: { ...counts.reused }, transferred: { ...counts.transferred } }),
    close: () => {
      if (windows.get(pool) === counts) windows.delete(pool);
    },
  };
}

/** Only count bodies from a completed, validated cache-enabled read on this pool. */
export function observeShardCacheRead(pool: Pool, reused: PartCounts, transferred: PartCounts) {
  const counts = windows.get(pool);
  if (!counts) return;
  counts.reads++;
  for (const part of ['shell', 'draw', 'participant'] as const) {
    counts.reused[part] += reused[part];
    counts.transferred[part] += transferred[part];
  }
}
