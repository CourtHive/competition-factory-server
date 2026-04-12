import { deriveBoltState } from './scorebug.transform';
import { BoltHistoryDocument } from '../types/bolt-history-document';
import { ClockAnchor, VideoBoardPayload, VideoBoardScoreboard } from '../types/video-board-payload';

function getBoltScore(doc: BoltHistoryDocument, sideNumber: 1 | 2): number {
  const sets = doc.engineState?.score?.sets;
  if (!Array.isArray(sets) || sets.length === 0) return 0;
  const current = sets[sets.length - 1];
  return Number(current?.[`side${sideNumber}Score`] ?? 0);
}

function getArcScore(doc: BoltHistoryDocument, sideNumber: 1 | 2): number {
  const sets = doc.engineState?.score?.sets;
  if (!Array.isArray(sets)) return 0;
  return sets.reduce((sum: number, set: any) => sum + Number(set?.[`side${sideNumber}Score`] ?? 0), 0);
}

function isSideServing(doc: BoltHistoryDocument, sideNumber: 1 | 2): boolean {
  const sets = doc.engineState?.score?.sets;
  if (!Array.isArray(sets) || sets.length === 0) return false;
  const current = sets[sets.length - 1];
  const serverId = current?.serverParticipantId;
  if (!serverId) return false;
  const side = doc.sides?.find((s) => s.sideNumber === sideNumber);
  return side?.participant?.participantId === serverId;
}

function buildScoreboard(doc: BoltHistoryDocument): VideoBoardScoreboard {
  return {
    side1: {
      boltScore: getBoltScore(doc, 1),
      arcScore: getArcScore(doc, 1),
      isServing: isSideServing(doc, 1),
    },
    side2: {
      boltScore: getBoltScore(doc, 2),
      arcScore: getArcScore(doc, 2),
      isServing: isSideServing(doc, 2),
    },
  };
}

function buildBoltClock(doc: BoltHistoryDocument, anchorTimestamp: string): ClockAnchor {
  return {
    remainingMs: doc.boltClockRemainingMs ?? 0,
    anchorTimestamp,
    running: doc.boltStarted && !doc.pausedOnExit && !doc.boltExpired && !doc.boltComplete,
  };
}

function buildServeClock(doc: BoltHistoryDocument, anchorTimestamp: string): ClockAnchor {
  return {
    remainingMs: doc.serveClockRemainingMs ?? 0,
    anchorTimestamp,
    running: doc.boltStarted && !doc.pausedOnExit && !doc.boltExpired && !doc.boltComplete,
  };
}

export function buildVideoBoardPayload(doc: BoltHistoryDocument, sequence: number): VideoBoardPayload {
  const anchorTimestamp = new Date().toISOString();
  const boltNumber = Math.max(1, (doc.engineState?.score?.sets?.length ?? 1));
  return {
    matchUpId: doc.tieMatchUpId,
    bolt: {
      number: boltNumber,
      state: deriveBoltState(doc),
      boltClock: buildBoltClock(doc, anchorTimestamp),
      serveClock: buildServeClock(doc, anchorTimestamp),
    },
    scoreboard: buildScoreboard(doc),
    sequence,
    generatedAt: anchorTimestamp,
  };
}
