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

import { Logger } from '@nestjs/common';

const logger = new Logger('TournamentMutex');

export const LOCK_TIMEOUT_ERROR = 'Tournament lock acquisition timed out';
const DEFAULT_TIMEOUT_MS = 30_000;

interface LockEntry {
  queue: (() => void)[];
  active: boolean;
}

const locks = new Map<string, LockEntry>();

function acquire(id: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  let entry = locks.get(id);
  if (!entry) {
    entry = { queue: [], active: false };
    locks.set(id, entry);
  }

  if (!entry.active) {
    entry.active = true;
    return Promise.resolve();
  }

  logger.log(`Request queuing for lock on tournament ${id} (queue depth: ${entry.queue.length + 1})`);

  return new Promise<void>((resolve, reject) => {
    const resolver = () => {
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      const idx = entry.queue.indexOf(resolver);
      if (idx !== -1) entry.queue.splice(idx, 1);
      logger.warn(`Lock timeout after ${timeoutMs}ms for tournament ${id}`);
      reject(new Error(LOCK_TIMEOUT_ERROR));
    }, timeoutMs);

    entry.queue.push(resolver);
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
  const acquiredIds: string[] = [];

  try {
    for (const id of sortedIds) {
      await acquire(id);
      acquiredIds.push(id);
    }
  } catch (err) {
    // Release any locks already acquired before the timeout
    for (const id of acquiredIds) {
      release(id);
    }
    throw err;
  }

  try {
    return await fn();
  } finally {
    for (const id of sortedIds) {
      release(id);
    }
  }
}
