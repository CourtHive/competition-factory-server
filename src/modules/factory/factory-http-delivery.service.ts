import { TournamentBroadcastService } from '../messaging/broadcast/tournament-broadcast.service';
import { ROSTER_SAFE_TOPICS } from './engines/getMutationEngine';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { FactoryService } from './factory.service';

/**
 * Cache-key prefixes scoped to ONE entity rather than the whole tournament. These are the only keys
 * eligible to be spared when a mutation reports targeted evictions.
 *
 * Single list on purpose: a tier registered in one place and forgotten in the other is silently
 * either over-swept (loses the granularity it was added for) or under-swept (serves stale).
 */
const PER_ENTITY_PREFIXES = ['ged|', 'gdd|', 'gsd|'] as const;

/** The tournament participant roster. Tournament-scoped, and far slower-changing than the rest. */
const ROSTER_KEY_PREFIX = 'gtp|';

@Injectable()
export class FactoryHttpDelivery {
  constructor(
    private readonly factoryService: FactoryService,
    private readonly broadcastService: TournamentBroadcastService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  // Side-table of issued cache keys per tournamentId. cache-manager has
  // no prefix-delete primitive, so we record every key shape we hand to
  // it (gmr|<tid>[|<filters>], gac|<tid>, gti|<tid>, gti|<tid>|<flags>,
  // ged|<tid>|<eid>, gtm|<tid>, gtp|<tid>) and iterate-delete on write.
  // All current keys are shaped `<prefix>|<tid>[|<...>]`, so segment [1]
  // is the tournament id — see trackTournamentKey.
  //
  // Memory bound: each tournament's Set is capped via FIFO eviction so a
  // read-only public viewer that polls thousands of flag-variant
  // combinations can't grow the side-table without limit. When a key is
  // evicted from the tracking Set, the corresponding cache entry is
  // simply not iterate-evicted on the next mutation — it ages out via
  // the 3-minute cache-manager TTL instead. The cap matches the
  // expected superset of distinct keys a single tournament can produce
  // (5 fixed + 16 flag variants + up to ~150 per-event keys).
  private static readonly KEYS_PER_TOURNAMENT_CAP = 200;
  private readonly cacheKeysByTournament = new Map<string, Set<string>>();

  // Stringified-falsy values we refuse to use as tournament-id buckets.
  // Filtered post-hoc rather than at key construction because the key
  // is built across many call sites; a single chokepoint here is the
  // cheapest correct fix.
  private static readonly REJECTED_TID_LITERALS = new Set(['undefined', 'null', 'NaN', 'false', '']);

  private trackTournamentKey(key: string): void {
    const segments = key.split('|');
    const tid = segments[1];
    if (!tid || FactoryHttpDelivery.REJECTED_TID_LITERALS.has(tid)) return;
    let set = this.cacheKeysByTournament.get(tid);
    if (!set) {
      set = new Set<string>();
      this.cacheKeysByTournament.set(tid, set);
    }
    set.add(key);
    // FIFO eviction once we cross the cap — Set preserves insertion
    // order, so the first iterator value is the oldest entry.
    while (set.size > FactoryHttpDelivery.KEYS_PER_TOURNAMENT_CAP) {
      const oldest = set.values().next().value;
      if (oldest === undefined) break;
      set.delete(oldest);
    }
  }

  async cacheFx(key, fx, params) {
    if (key && typeof key === 'string') {
      const cachedData: any = await this.cacheManager.get(key);
      if (cachedData) {
        if (typeof cachedData === 'object') cachedData._cached = true;
        Logger.verbose(`Cache hit: ${key}`);
        return cachedData;
      }
    }
    const result = await fx(params);
    if (!result.error && key && typeof key === 'string') {
      this.cacheManager.set(key, result, 60 * 3 * 1000); // 3 minutes
      this.trackTournamentKey(key);
    }
    return result;
  }

  /**
   * Evict every issued per-tournament cache key after a mutation. Live
   * WebSocket clients are already notified by broadcastMutation; this
   * exists for HTTP polling clients (mobile, public viewers, automated
   * dashboards) that would otherwise eat the 3-min cache TTL after a
   * write and serve stale data for that window.
   *
   * Driven by the cacheKeysByTournament side-table so we cover every
   * variant we hand to cacheFx — including flag-variant keys
   * (gti|<tid>|<flags>) and per-event keys (ged|<tid>|<eid>) that the
   * previous fixed-prefix list missed.
   */
  invalidateTournamentCache(
    tournamentIds: readonly string[],
    evictedEventKeys?: readonly string[],
    warmedEventKeys?: readonly string[],
    unnarrowablePrefixes?: readonly string[],
    noticeTopics?: readonly string[],
  ): void {
    // Per-event `ged|<tid>|<eid>` payloads are the bulk of this cache — measured at 3.26 MB across a
    // Grand-Slam-shaped tournament's five events, four times the tournamentRecord they derive from
    // (Mentat/tools/slam-scale-bench). Sweeping them all on every write meant one score discarded the
    // cached data for every OTHER event too. Verified with the same harness that a score leaves other
    // events' payloads byte-identical, so evicting only the affected event is sound.
    //
    // FAIL-SAFE: narrow ONLY when the mutation actually reported targeted evictions. An empty list
    // means no notice carried an eventId, so we cannot know which events changed and fall back to the
    // original tournament-wide sweep. "Invalidate less" must never silently become "serve stale".
    // Set, not Array.includes — membership check inside a per-key loop (coding-standards: Set + .has()).
    const evicted = new Set(evictedEventKeys ?? []);
    // Keys re-seeded by `warmCache` must survive: a warmed key is by definition also an evicted one,
    // so without this the sweep would delete exactly the payload the caller just paid to rebuild.
    const warmed = new Set(warmedEventKeys ?? []);
    const narrow = evicted.size > 0;
    // A tier whose handlers could not attribute a change is swept wholesale. Without this, a change
    // the handlers saw but could not target looks identical to no change at all, and the key is
    // spared — stale for the full TTL. See FactoryRequestContext.unnarrowablePrefixes.
    const unnarrowable = new Set(unnarrowablePrefixes ?? []);

    // The participant ROSTER (`gtp|<tid>`) is spared when nothing this mutation did could have moved
    // it. A different question from the per-entity narrowing above: that asks WHICH entity changed,
    // this asks WHAT KIND of change it was. Today a single point scored discards the roster, and the
    // next reader rebuilds a list that did not change.
    //
    // Fail-safe in both directions. `topics.length > 0` because a mutation that emitted no notices
    // tells us nothing, and silence must not read as "nothing happened". `every` because a mutation
    // emits several topics and one roster-affecting topic is enough — sparing on "some were safe"
    // would serve a stale roster whenever a withdrawal rode along with a score.
    const topics = noticeTopics ?? [];
    const rosterUnchanged = topics.length > 0 && topics.every((t) => ROSTER_SAFE_TOPICS.has(t));

    for (const tid of tournamentIds) {
      if (!tid || typeof tid !== 'string') continue;
      const keys = this.cacheKeysByTournament.get(tid);
      if (!keys) continue;
      const retained = new Set<string>();
      for (const key of keys) {
        if (warmed.has(key)) {
          retained.add(key);
          continue;
        }
        if (rosterUnchanged && key.startsWith(ROSTER_KEY_PREFIX)) {
          retained.add(key);
          continue;
        }
        // A per-ENTITY key (event, draw, structure) is spared only when the handlers already evicted
        // the ones that changed. Tournament-scoped keys always go — they aggregate across entities.
        const prefix = PER_ENTITY_PREFIXES.find((p) => key.startsWith(p));
        const perEntity = !!prefix && !unnarrowable.has(prefix);
        if (narrow && perEntity && !evicted.has(key)) {
          retained.add(key);
          continue;
        }
        void this.cacheManager.del(key);
      }
      // Keep tracking the keys still live, so a later write can still find and evict them.
      if (retained.size) this.cacheKeysByTournament.set(tid, retained);
      else this.cacheKeysByTournament.delete(tid);
    }
  }

  async commit(payload) {
    const result = await this.factoryService.executionQueue(payload, {
      cacheManager: this.cacheManager,
      // Lets a warmed key enter the side-table. The WS path has no side-table and passes nothing.
      trackCacheKey: (key: string) => this.trackTournamentKey(key),
    });
    if (result?.success && !result.deduplicated) {
      const { publicNotices } = result;
      // The stamped payload, as the socket path broadcasts: it carries the verified userId, and the
      // sender's `originClientId` so the sender recognises its own mutation (no connection to exclude).
      // Its methods are the canonical ones: an intention that wrote nothing is never replayed elsewhere.
      this.broadcastService.broadcastMutation(
        { ...payload, methods: result.appliedMethods ?? payload.methods },
        {
          serverUpdatedAt: result.serverUpdatedAt,
          previousServerUpdatedAt: result.previousServerUpdatedAt,
        },
      );
      this.broadcastService.broadcastPublicNotices(payload, publicNotices);
      this.invalidateTournamentCache(
        payload.tournamentIds ?? (payload.tournamentId ? [payload.tournamentId] : []),
        result?.evictedEventKeys,
        result?.warmedEventKeys,
        result?.unnarrowablePrefixes,
        result?.noticeTopics,
      );
    }
    return result;
  }
}
