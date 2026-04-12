import { BoltHistoryDocument } from '../types/bolt-history-document';
import { ScorebugPayload, ScorebugSide } from '../types/scorebug-payload';

/**
 * Document-derivable bolt states. The wider `BoltState` union also
 * includes `'rally'` and `'timeout'`, which are runtime sub-states
 * the projector cannot derive from a persisted document.
 */
export type DocumentDerivedBoltState = 'pre' | 'play' | 'paused' | 'complete';

export function deriveBoltState(doc: BoltHistoryDocument): DocumentDerivedBoltState {
  if (doc.boltComplete) return 'complete';
  if (!doc.boltStarted) return 'pre';
  if (doc.pausedOnExit) return 'paused';
  return 'play';
}

function getCurrentSetIndex(doc: BoltHistoryDocument): number {
  const sets = doc.engineState?.score?.sets;
  if (!Array.isArray(sets) || sets.length === 0) return 0;
  return sets.length - 1;
}

function getBoltScore(doc: BoltHistoryDocument, sideNumber: 1 | 2): number {
  const sets = doc.engineState?.score?.sets;
  if (!Array.isArray(sets) || sets.length === 0) return 0;
  const current = sets[sets.length - 1];
  if (!current) return 0;
  return Number(current[`side${sideNumber}Score`] ?? 0);
}

function getArcScore(doc: BoltHistoryDocument, sideNumber: 1 | 2): number {
  const sets = doc.engineState?.score?.sets;
  if (!Array.isArray(sets)) return 0;
  return sets.reduce((sum: number, set: any) => sum + Number(set?.[`side${sideNumber}Score`] ?? 0), 0);
}

function getCurrentServerParticipantId(doc: BoltHistoryDocument): string | undefined {
  const sets = doc.engineState?.score?.sets;
  if (!Array.isArray(sets) || sets.length === 0) return undefined;
  const current = sets[sets.length - 1];
  return current?.serverParticipantId;
}

function getServeSide(doc: BoltHistoryDocument): 'DEUCE' | 'AD' | undefined {
  const points = doc.engineState?.history?.points;
  if (!Array.isArray(points) || points.length === 0) return 'DEUCE';
  // Crude derivation: total points in current game determines side. Even -> DEUCE, odd -> AD.
  // The renderer can refine this with sub-game state if/when surfaced.
  const lastPoint = points[points.length - 1];
  if (!lastPoint) return 'DEUCE';
  const total = Number(lastPoint?.side1Score ?? 0) + Number(lastPoint?.side2Score ?? 0);
  return total % 2 === 0 ? 'DEUCE' : 'AD';
}

function buildSide(
  doc: BoltHistoryDocument,
  sideNumber: 1 | 2,
  currentServerId: string | undefined,
): ScorebugSide {
  const side = doc.sides?.find((s) => s.sideNumber === sideNumber);
  const participantId = side?.participant?.participantId;
  const isServing = Boolean(currentServerId && participantId && currentServerId === participantId);
  const timeoutsAllowed = Number(doc.competitionFormat?.timeoutsAllowed ?? doc.engineState?.competitionFormat?.timeoutsAllowed ?? 3);
  const used = Number(doc.timeoutsUsed?.[sideNumber] ?? 0);
  return {
    teamName: side?.participant?.participantName ?? '',
    playerName: side?.participant?.participantName ?? '',
    boltScore: getBoltScore(doc, sideNumber),
    arcScore: getArcScore(doc, sideNumber),
    isServing,
    serveSide: isServing ? getServeSide(doc) : undefined,
    timeoutsRemaining: Math.max(0, timeoutsAllowed - used),
  };
}

export function buildScorebugPayload(doc: BoltHistoryDocument): ScorebugPayload {
  const currentServerId = getCurrentServerParticipantId(doc);
  const boltNumber = Math.max(1, getCurrentSetIndex(doc) + 1);
  const state = deriveBoltState(doc);
  return {
    kind: 'event',
    matchUpId: doc.tieMatchUpId,
    tournamentId: doc.tournamentId,
    format: 'INTENNSE',
    side1: buildSide(doc, 1, currentServerId),
    side2: buildSide(doc, 2, currentServerId),
    bolt: {
      number: boltNumber,
      label: doc.engineState?.competitionFormat?.label,
      boltClockMs: doc.boltClockRemainingMs ?? 0,
      serveClockMs: doc.serveClockRemainingMs ?? 0,
      state,
    },
    matchUpStatus: doc.boltComplete ? 'COMPLETED' : 'IN_PROGRESS',
    generatedAt: new Date().toISOString(),
  };
}
