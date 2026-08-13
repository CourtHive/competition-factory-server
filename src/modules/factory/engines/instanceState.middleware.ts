import { Injectable, NestMiddleware } from '@nestjs/common';

import asyncGlobalState from './asyncGlobalState';

/**
 * Opens a per-request factory engine-state store around EVERY HTTP request.
 *
 * The factory routes all state access (setState / getTournamentRecords / governor reads /
 * validateL2) through the process-global provider CFS registers as asyncGlobalState
 * (getMutationEngine.ts). A handler that touches the engine WITHOUT an active store makes
 * getInstanceState() lazily `enterWith()` an implicit state: still isolated per request
 * (fail-soft — no cross-request bleed), but it is never scope-released and it logs a
 * warning. Rather than wrap each entry point by hand — the omission that left /factory/save
 * and /factory/remove unwrapped and spamming warnings under the ITA re-own — this middleware
 * establishes ONE scoped store for the whole request so every current and future REST handler
 * inherits it, and it is released when the request's async context unwinds.
 *
 * `runWithInstanceState` uses AsyncLocalStorage.run(), so the store propagates to every async
 * continuation the handler spawns after `next()` returns. The Socket.IO mutation path opens
 * its own store inside executionQueue and never traverses HTTP middleware, so it is
 * unaffected; a handler that also calls an explicitly-wrapped helper just nests a fresh
 * scope, which is harmless.
 */
@Injectable()
export class InstanceStateMiddleware implements NestMiddleware {
  use(_req: unknown, _res: unknown, next: () => void): void {
    asyncGlobalState.runWithInstanceState(() => next());
  }
}
