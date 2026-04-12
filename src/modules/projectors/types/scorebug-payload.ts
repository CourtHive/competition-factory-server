export type BoltState = 'pre' | 'play' | 'rally' | 'paused' | 'timeout' | 'complete';

export interface ScorebugSide {
  teamName: string;
  playerName: string;
  boltScore: number;
  arcScore: number;
  isServing: boolean;
  serveSide?: 'DEUCE' | 'AD';
  timeoutsRemaining: number;
}

export interface ScorebugPayload {
  /**
   * Discriminator field for the dual-stream Expression design.
   * Consumers route by this field — `'event'` here, `'tick'` on a
   * `ScorebugClockTick`. Required (not optional) because there are no
   * existing scorebug consumers in the wild — this whole pipeline was
   * built fresh in this session.
   */
  kind: 'event';
  matchUpId: string;
  tournamentId: string;
  format: 'INTENNSE';
  side1: ScorebugSide;
  side2: ScorebugSide;
  bolt: {
    number: number;
    label?: string;
    boltClockMs: number;
    serveClockMs: number;
    state: BoltState;
  };
  matchUpStatus: 'IN_PROGRESS' | 'COMPLETED';
  generatedAt: string;
}
