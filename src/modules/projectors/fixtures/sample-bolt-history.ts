import { BoltHistoryDocument } from '../types/bolt-history-document';

export function buildSampleBoltHistory(overrides: Partial<BoltHistoryDocument> = {}): BoltHistoryDocument {
  return {
    tieMatchUpId: 'tie-sample-1',
    parentMatchUpId: 'parent-sample-1',
    tournamentId: 'tour-sample-1',
    sides: [
      { sideNumber: 1, participant: { participantId: 'p1', participantName: 'Alice' } },
      { sideNumber: 2, participant: { participantId: 'p2', participantName: 'Bob' } },
    ],
    engineState: {
      score: { sets: [] },
      history: { points: [] },
      competitionFormat: { timeoutsAllowed: 3, label: "Men's Singles" },
    },
    boltStarted: false,
    boltExpired: false,
    boltComplete: false,
    timeoutsUsed: { 1: 0, 2: 0 },
    pausedOnExit: false,
    boltClockRemainingMs: 600000,
    serveClockRemainingMs: 25000,
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

export function buildMidBoltHistory(): BoltHistoryDocument {
  return buildSampleBoltHistory({
    boltStarted: true,
    timeoutsUsed: { 1: 1, 2: 0 },
    boltClockRemainingMs: 420000,
    serveClockRemainingMs: 18000,
    matchUpFormat: 'SET3-S:T7XA-S:T10P',
    competitionFormat: { sport: 'INTENNSE', timeoutsAllowed: 3 },
    engineState: {
      score: {
        sets: [
          {
            side1Score: 5,
            side2Score: 3,
            side1PointScore: 2,
            side2PointScore: 1,
            serverParticipantId: 'p1',
          },
        ],
      },
      history: {
        points: [
          { side1Score: 5, side2Score: 3, winnerParticipantId: 'p1' },
        ],
      },
      competitionFormat: { timeoutsAllowed: 3, label: "Men's Singles" },
    },
  });
}

export function buildStandardMidMatchHistory(): BoltHistoryDocument {
  return buildSampleBoltHistory({
    boltStarted: true,
    matchUpFormat: 'SET3-S:6/TB7',
    competitionFormat: { sport: 'TENNIS' },
    engineState: {
      score: {
        sets: [
          { side1Score: 6, side2Score: 4, serverParticipantId: 'p2' },
          { side1Score: 3, side2Score: 5, side1PointScore: 0, side2PointScore: 0, serverParticipantId: 'p2' },
        ],
      },
      history: { points: [] },
    },
  });
}

export function buildCompleteBoltHistory(): BoltHistoryDocument {
  return buildSampleBoltHistory({
    boltStarted: true,
    boltComplete: true,
    boltClockRemainingMs: 0,
    serveClockRemainingMs: 0,
    timeoutsUsed: { 1: 1, 2: 2 },
    matchUpFormat: 'SET3-S:T7XA-S:T10P',
    competitionFormat: { sport: 'INTENNSE', timeoutsAllowed: 3 },
    engineState: {
      score: {
        sets: [
          { side1Score: 21, side2Score: 18, serverParticipantId: 'p1' },
        ],
      },
      history: {
        points: [{ side1Score: 21, side2Score: 18, winnerParticipantId: 'p1' }],
      },
      competitionFormat: { timeoutsAllowed: 3, label: "Men's Singles" },
    },
  });
}
