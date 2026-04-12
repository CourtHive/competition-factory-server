import { deriveBoltState } from './scorebug.transform';
import { BoltHistoryDocument } from '../types/bolt-history-document';
import {
  PublicLiveFormat,
  PublicLivePayload,
  PublicLiveSide,
  PublicLiveStatus,
} from '../types/public-live-payload';

/**
 * Build a compact PublicLivePayload from the canonical BoltHistoryDocument.
 *
 * Strips:
 *   - per-point history (history.points[])
 *   - substitution history
 *   - per-player time snapshots
 *   - any field a public viewer doesn't need
 *
 * Keeps:
 *   - identity (matchUpId, tournamentId)
 *   - format hint for renderer template selection
 *   - per-side display info (name, set scores, game score, serving)
 *   - INTENNSE-specific bolt block when applicable (bolt number, state, clocks)
 *   - status enum
 */
export function buildPublicLivePayload(doc: BoltHistoryDocument): PublicLivePayload {
  const isIntennse = isIntennseFormat(doc);
  const format: PublicLiveFormat = isIntennse ? 'INTENNSE' : 'STANDARD';
  const status = derivePublicStatus(doc);

  return {
    matchUpId: doc.tieMatchUpId,
    tournamentId: doc.tournamentId,
    format,
    status,
    side1: buildSide(doc, 1),
    side2: buildSide(doc, 2),
    intennseBolt: isIntennse
      ? {
          number: getCurrentBoltNumber(doc),
          state: deriveBoltState(doc),
          boltClockMs: doc.boltClockRemainingMs ?? 0,
          serveClockMs: doc.serveClockRemainingMs ?? 0,
        }
      : undefined,
    generatedAt: new Date().toISOString(),
  };
}

function isIntennseFormat(doc: BoltHistoryDocument): boolean {
  if (doc.competitionFormat?.sport === 'INTENNSE') return true;
  const matchUpFormat = doc.matchUpFormat ?? doc.engineState?.matchUpFormat ?? '';
  return typeof matchUpFormat === 'string' && matchUpFormat.includes('XA-S:T');
}

function derivePublicStatus(doc: BoltHistoryDocument): PublicLiveStatus {
  if (doc.boltComplete) return 'completed';
  if (doc.boltStarted) return 'in_progress';
  return 'pre';
}

function getCurrentBoltNumber(doc: BoltHistoryDocument): number {
  const sets = doc.engineState?.score?.sets;
  if (!Array.isArray(sets) || sets.length === 0) return 1;
  return sets.length;
}

function getSetScores(doc: BoltHistoryDocument, sideNumber: 1 | 2): number[] {
  const sets = doc.engineState?.score?.sets;
  if (!Array.isArray(sets)) return [];
  return sets.map((set: any) => Number(set?.[`side${sideNumber}Score`] ?? 0));
}

function getCurrentGameScore(doc: BoltHistoryDocument, sideNumber: 1 | 2): number | undefined {
  const sets = doc.engineState?.score?.sets;
  if (!Array.isArray(sets) || sets.length === 0) return undefined;
  const current = sets[sets.length - 1];
  const value = current?.[`side${sideNumber}PointScore`];
  return typeof value === 'number' ? value : undefined;
}

function isCurrentlyServing(doc: BoltHistoryDocument, sideNumber: 1 | 2): boolean {
  const sets = doc.engineState?.score?.sets;
  if (!Array.isArray(sets) || sets.length === 0) return false;
  const current = sets[sets.length - 1];
  const serverId = current?.serverParticipantId;
  if (!serverId) return false;
  const side = doc.sides?.find((s) => s.sideNumber === sideNumber);
  return side?.participant?.participantId === serverId;
}

function buildSide(doc: BoltHistoryDocument, sideNumber: 1 | 2): PublicLiveSide {
  const side = doc.sides?.find((s) => s.sideNumber === sideNumber);
  const name = side?.participant?.participantName ?? '';
  return {
    teamName: name,
    playerName: name,
    setScores: getSetScores(doc, sideNumber),
    gameScore: getCurrentGameScore(doc, sideNumber),
    isServing: isCurrentlyServing(doc, sideNumber),
  };
}
