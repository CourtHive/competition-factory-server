import { AsyncLocalStorage } from 'node:async_hooks';

import type { DeltaBuffer } from '../projection/projectionTypes';

/**
 * Request-scoped context for the factory notice subscriptions.
 *
 * DECISION: these three live in a CFS-owned AsyncLocalStorage, NOT in the factory engine state.
 * WHY: `publicNotices`, `deltaBuffer` and the per-request `cacheManager` are server concerns.
 * The factory owns the shape of `ImplemtationGlobalStateTypes`; widening it with CFS fields would
 * put the server's request plumbing inside the library's contract.
 *
 * WHY IT EXISTS AT ALL: the subscription handlers are deploy-scoped in shape — identical on every
 * request, nothing tournament-, provider- or user-dependent. They were re-registered per mutation
 * solely to rebind these three via closure, and because factory subscriptions are a single
 * per-context slot per topic, a second concurrent request overwrote the first's handlers and its
 * notices were delivered into the wrong arrays. Registering the handlers ONCE globally and reading
 * the per-request values from here removes that failure mode by construction: there is no longer
 * anything to overwrite. See competition-factory#4564.
 */
export type FactoryRequestContext = {
  publicNotices?: any[];
  deltaBuffer?: DeltaBuffer;
  services?: any;
  /**
   * `ged|<tid>|<eid>` keys this request evicted precisely, because a notice carried the eventId.
   *
   * Read by the controller's `invalidateTournamentCache`: when non-empty it skips its blanket
   * per-event sweep, trusting the targeted evictions. When EMPTY it sweeps every `ged|` key as
   * before. That is the fail-safe — a mutation whose notices never carry an eventId records
   * nothing here and gets the old, broader behaviour rather than leaving stale event data.
   */
  evictedEventKeys?: Set<string>;
};

const asyncLocalStorage = new AsyncLocalStorage<FactoryRequestContext>();

/**
 * DECISION: absent context returns an empty object rather than throwing or inventing state.
 * WHY: the handlers are registered process-wide, so they can fire for work that never established
 * a request context. Every consumer already guards (`services?.cacheManager`, `if (!publicNotices)
 * continue`, recorders no-op on an undefined buffer), so an empty context degrades to "collect
 * nothing, evict nothing" — never to another request's arrays.
 */
const EMPTY: FactoryRequestContext = Object.freeze({});

/** Bind a request context to `fn` and every async context it spawns. */
export function runWithRequestContext<T>(context: FactoryRequestContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

/** The current request's context, or an empty one when called outside a request. */
export function getRequestContext(): FactoryRequestContext {
  return asyncLocalStorage.getStore() ?? EMPTY;
}
