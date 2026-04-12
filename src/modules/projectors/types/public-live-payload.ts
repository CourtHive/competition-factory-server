/**
 * Compact public-live broadcast payload for the courthive-public viewer.
 *
 * Derived from a BoltHistoryDocument by `public-live.transform.ts`.
 * Smaller than the full bolt-history document — strips the per-point
 * history (which can be 100s of points) and exposes only the fields a
 * read-only viewer needs.
 *
 * This is the third projector consumer kind alongside scorebug
 * (Expression broadcast graphic) and video-board (in-arena renderer).
 * Where the other two go out via HTTP POST to external consumers, this
 * one is dispatched in-process to PublicGateway.broadcastLiveScore via
 * the new callback-style consumer registration.
 */

export type PublicLiveFormat = 'STANDARD' | 'INTENNSE';
export type PublicLiveStatus = 'pre' | 'in_progress' | 'completed';

export interface PublicLiveSide {
  teamName: string;
  playerName: string;
  setScores: number[]; // one entry per completed/current set
  gameScore?: number;  // current game points (within the current set)
  isServing: boolean;
}

export interface PublicLiveIntennseBolt {
  number: number;          // bolt 1, 2, ...
  state: 'pre' | 'play' | 'paused' | 'complete';
  boltClockMs: number;
  serveClockMs: number;
}

export interface PublicLivePayload {
  matchUpId: string;
  tournamentId: string;
  format: PublicLiveFormat;
  status: PublicLiveStatus;
  side1: PublicLiveSide;
  side2: PublicLiveSide;
  /** Present only when format === 'INTENNSE'. */
  intennseBolt?: PublicLiveIntennseBolt;
  generatedAt: string;
}
