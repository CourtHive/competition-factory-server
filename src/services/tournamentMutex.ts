/**
 * Per-tournament async mutex for serializing mutations.
 *
 * Ensures that concurrent executionQueue requests targeting the same
 * tournament(s) are processed sequentially, preventing lost updates
 * from interleaved read-modify-write cycles.
 *
 * When multiple tournament IDs are involved, locks are acquired in
 * sorted order to prevent deadlocks.
 */

interface LockEntry {
  queue: (() => void)[];
  active: boolean;
}

const locks = new Map<string, LockEntry>();

function acquire(id: string): Promise<void> {
  let entry = locks.get(id);
  if (!entry) {
    entry = { queue: [], active: false };
    locks.set(id, entry);
  }

  if (!entry.active) {
    entry.active = true;
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    entry.queue.push(resolve);
  });
}

function release(id: string): void {
  const entry = locks.get(id);
  if (!entry) return;

  if (entry.queue.length > 0) {
    const next = entry.queue.shift()!;
    next();
  } else {
    locks.delete(id);
  }
}

export async function withTournamentLock<T>(tournamentIds: string[], fn: () => Promise<T>): Promise<T> {
  const sortedIds = [...tournamentIds].sort();

  for (const id of sortedIds) {
    await acquire(id);
  }

  try {
    return await fn();
  } finally {
    for (const id of sortedIds) {
      release(id);
    }
  }
}
