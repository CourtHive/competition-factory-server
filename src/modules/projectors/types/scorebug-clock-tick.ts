/**
 * Sub-second clock tick payload for Expression-style broadcast scorebug
 * consumers. Fires every SCOREBUG_TICK_INTERVAL_MS (default 250ms) while
 * a bolt clock is in the `play` state. Stops on pause / expire / complete.
 *
 * Discriminated from the event-driven `ScorebugPayload` by the required
 * `kind: 'tick'` field — `ScorebugPayload` carries `kind: 'event'`.
 * Consumers route on the `kind` field at the intake.
 *
 * Tick payloads are inherently disposable: the next tick (250ms later)
 * supersedes any failure, so the dispatch path uses fire-and-forget
 * with no retry.
 */
export interface ScorebugClockTick {
  kind: 'tick';
  matchUpId: string;
  tournamentId: string;
  format: string;          // e.g. 'INTENNSE' — same hint as ScorebugPayload.format
  state: 'play';           // ticks ONLY fire when state is 'play'
  boltClockMs: number;     // current extrapolated remaining time
  serveClockMs: number;    // current extrapolated remaining time
  /** Optional per-player clocks, for sports that track on-court time. */
  playerClocks?: Record<string, { remainingMs: number; isOnCourt: boolean }>;
  /** ISO timestamp at the moment this tick was generated. */
  generatedAt: string;
}
