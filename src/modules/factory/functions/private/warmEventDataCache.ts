import { Logger } from '@nestjs/common';

import { publicQueries } from 'src/modules/factory/functions/public';

/**
 * How long a cached read lives. Shared with the controller's `cacheFx` so a seeded entry and a
 * naturally-cached one expire together — a seeded entry outliving a read entry would be a subtle
 * source of "why is this stale for longer than the cache TTL".
 */
export const CACHE_TTL_MS = 60 * 3 * 1000;

type WarmArgs = {
  /** `ged|<tournamentId>|<eventId>` keys this mutation evicted. */
  evictedEventKeys: readonly string[];
  cacheManager?: { set?: (key: string, value: any, ttl: number) => any };
  /** Tournament storage, passed straight through to the same query the cached read uses. */
  storage: any;
  /**
   * Optional: register the seeded key with the HTTP controller's side-table, so a later blanket
   * sweep can find it. The WebSocket path has no side-table and passes nothing — safe, because
   * `evictEventData` deletes per-event keys by exact key on every subsequent mutation and never
   * consults the side-table.
   */
  trackKey?: (key: string) => void;
};

/**
 * Re-seed the per-event payloads a mutation just evicted, so the first public reader after a publish
 * does not pay a cache miss.
 *
 * ONE seeding path, deliberately. `factory.service.ts` `getEventData` is a thin wrapper over
 * `publicQueries.getEventData(params, storage)` — the same call made here — so a seeded entry is
 * byte-identical to what the cached read would have produced. That matters more than it looks: the
 * `invalidate rather than seed` comment in `getMutationEngine.ts` records that seeding a *different*
 * shape (the notice's inner `eventData`, which has no `participants`) serves a payload that blanks
 * every bracket side to TBD for the full TTL. Duplicating this logic per transport would reintroduce
 * exactly that risk.
 *
 * Called from `executionQueue()` so BOTH transports get it: HTTP (`factory.controller` →
 * `factory.service` → here) and WebSocket (`tmxMessages` → here). Opt-in via `payload.warmCache`.
 *
 * @returns the keys actually seeded — the HTTP controller must spare these from its sweep, since a
 * re-seeded key is by definition also in `evictedEventKeys` and would otherwise be deleted again.
 */
export async function warmEventDataCache({
  evictedEventKeys,
  cacheManager,
  storage,
  trackKey,
}: WarmArgs): Promise<string[]> {
  if (!cacheManager?.set || !storage) return [];
  const warmed: string[] = [];

  for (const key of evictedEventKeys) {
    const [prefix, tournamentId, eventId, profile] = key.split('|');
    if (prefix !== 'ged' || !tournamentId || !eventId) continue;
    // Skip the `drawsProfile: 'STUBS'` variant (`ged|<tid>|<eid>|s`). The rebuild below is a FULL
    // payload, so seeding it under the thin key would pin the ~600 KB document where a ~600 BYTE one
    // belongs — served silently for the whole TTL to every caller asking for stubs. Not warmed rather
    // than warmed correctly on purpose: a stub rebuild is cheap enough that a cache miss costs
    // nothing, and one seeding path is what keeps a seeded entry byte-identical to a read entry.
    if (profile) continue;

    const result: any = await publicQueries.getEventData({ tournamentId, eventId }, storage);
    // A failed rebuild must not be cached — that would pin an error response for the whole TTL.
    // Surfaced rather than swallowed (A2): the caller asked for this work, so a failure is theirs
    // to see, and it is rare enough that per-occurrence logging cannot become spam.
    if (!result || result.error) {
      Logger.warn(`[warmEventDataCache] rebuild failed for ${key}: ${JSON.stringify(result?.error ?? 'no result')}`);
      continue;
    }

    await cacheManager.set(key, result, CACHE_TTL_MS);
    trackKey?.(key);
    warmed.push(key);
  }

  if (warmed.length) Logger.verbose(`[warmEventDataCache] seeded ${warmed.length} event payload(s)`);
  return warmed;
}
