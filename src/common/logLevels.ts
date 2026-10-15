import type { LogLevel } from '@nestjs/common';

/**
 * The levels the server's logger writes, in every environment.
 *
 * `log` was missing until 2026-10-15 while `verbose` and `debug` — the two noisier levels — were on, so every
 * `Logger.log` the server makes was dropped: production's Factory-Server log held 2,188 DEBUG and 656 VERBOSE lines
 * and not one LOG line. Startup reports such as `ConsumerBootstrap: registered N consumer endpoint(s)` were among
 * them, which left whether CFS had registered its score-relay `matchup-finalized` consumer unanswerable from the log
 * (it had; a Guidon journey had to prove it).
 */
export const LOG_LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
