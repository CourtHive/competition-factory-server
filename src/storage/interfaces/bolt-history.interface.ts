export const BOLT_HISTORY_STORAGE = Symbol('BOLT_HISTORY_STORAGE');

export interface TieMatchUpSide {
  sideNumber: 1 | 2;
  participant?: { participantId: string; participantName?: string };
  lineUp?: any[];
}

export interface BoltHistoryDocument {
  // Identity
  tieMatchUpId: string;
  parentMatchUpId: string;
  tournamentId: string;
  eventId?: string;
  drawId?: string;

  // Match identity
  matchUpFormat?: string;
  competitionFormat?: any;
  sides: TieMatchUpSide[];

  // Engine state — full ScoringEngine state (MatchUp-shaped from tods-competition-factory)
  engineState: any;

  // Bolt UI state
  boltStarted: boolean;
  boltExpired: boolean;
  boltComplete: boolean;
  timeoutsUsed: { 1: number; 2: number };
  pausedOnExit: boolean;

  // Clock snapshots (for resume)
  boltClockRemainingMs?: number;
  serveClockRemainingMs?: number;
  playerTimeSnapshots?: Record<string, { elapsedMs: number; isOnCourt: boolean }>;

  // Audit
  createdAt: string;
  updatedAt: string;
  scoredBy?: string;
  version: number;
}

export const VERSION_CONFLICT = 'VERSION_CONFLICT';

export interface IBoltHistoryStorage {
  findBoltHistory(params: {
    tieMatchUpId: string;
  }): Promise<{ document?: BoltHistoryDocument; error?: string }>;

  saveBoltHistory(params: {
    document: BoltHistoryDocument;
  }): Promise<{ success?: boolean; version?: number; error?: string }>;

  listBoltHistoryForTournament(params: {
    tournamentId: string;
  }): Promise<{ documents?: BoltHistoryDocument[]; error?: string }>;

  removeBoltHistory(params: {
    tieMatchUpId: string;
  }): Promise<{ success?: boolean; error?: string }>;
}
