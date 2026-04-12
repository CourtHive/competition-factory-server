import { BoltState } from './scorebug-payload';

export interface ClockAnchor {
  remainingMs: number;
  anchorTimestamp: string;
  running: boolean;
}

export interface VideoBoardScoreboard {
  side1: { boltScore: number; arcScore: number; isServing: boolean };
  side2: { boltScore: number; arcScore: number; isServing: boolean };
}

export interface VideoBoardPayload {
  matchUpId: string;
  bolt: {
    number: number;
    state: BoltState;
    boltClock: ClockAnchor;
    serveClock: ClockAnchor;
  };
  scoreboard: VideoBoardScoreboard;
  sequence: number;
  generatedAt: string;
}
