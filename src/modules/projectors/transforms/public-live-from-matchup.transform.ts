import { PublicLiveFormat, PublicLivePayload, PublicLiveSide, PublicLiveStatus } from '../types/public-live-payload';

/**
 * Build a `PublicLivePayload` directly from a tournamentRecord matchUp
 * object (the shape that the factory engine emits in MODIFY_MATCHUP
 * notices). This is the **non-INTENNSE / standard mutation path**:
 * any matchUp format that the factory's mutation engine touches —
 * standard tennis sets, pickleball, padel, badminton, squash, beach,
 * junior, doubles, team — flows through here.
 *
 * The INTENNSE bolt-history path (Phase 1) goes through
 * `public-live.transform.ts` which derives from a `BoltHistoryDocument`.
 * This transform is the parallel path for everything else (Phase 1.5).
 *
 * Both transforms produce the SAME `PublicLivePayload` shape so
 * courthive-public consumers don't need to know which path the data
 * came from. The `format` field is the only differentiator.
 *
 * Notable differences from the bolt-history transform:
 *
 * - `format` is `'STANDARD'` (sport-specific subtypes can be added later
 *   if specific renderers want them)
 * - `intennseBolt` is always undefined
 * - `gameScore` (current game points within the current set) is NOT
 *   derivable from a stored tournamentRecord matchUp — that requires a
 *   live ScoringEngine instance which the broadcast service doesn't
 *   have. Set to undefined; renderers fall back to set scores only.
 * - `isServing` is also not stored on the matchUp itself — set to
 *   false for both sides until we surface it elsewhere
 */
export function buildPublicLivePayloadFromMatchUp(
  matchUp: any,
  tournamentId: string,
): PublicLivePayload | null {
  if (!matchUp?.matchUpId || !tournamentId) return null;

  return {
    matchUpId: matchUp.matchUpId,
    tournamentId,
    format: deriveFormat(matchUp),
    status: deriveStatus(matchUp),
    side1: buildSide(matchUp, 1),
    side2: buildSide(matchUp, 2),
    intennseBolt: undefined,
    generatedAt: new Date().toISOString(),
  };
}

function deriveFormat(matchUp: any): PublicLiveFormat {
  // The bolt-history path always emits 'INTENNSE'. This transform is
  // explicitly the non-INTENNSE path, so any matchUp here is by
  // definition not from a bolt-history document — but a TEAM matchUp
  // with INTENNSE tieMatchUps could still come through if someone
  // mutates it via the factory engine, so check the matchUpFormat
  // string as a guard.
  const matchUpFormat = matchUp?.matchUpFormat ?? '';
  if (typeof matchUpFormat === 'string' && matchUpFormat.includes('XA-S:T')) {
    return 'INTENNSE';
  }
  return 'STANDARD';
}

function deriveStatus(matchUp: any): PublicLiveStatus {
  if (matchUp?.winningSide || matchUp?.matchUpStatus === 'COMPLETED') return 'completed';
  const sets = matchUp?.score?.sets;
  const hasAnyScore =
    Array.isArray(sets) &&
    sets.some(
      (set: any) =>
        Number(set?.side1Score ?? 0) > 0 ||
        Number(set?.side2Score ?? 0) > 0 ||
        Number(set?.side1TiebreakScore ?? 0) > 0 ||
        Number(set?.side2TiebreakScore ?? 0) > 0,
    );
  return hasAnyScore ? 'in_progress' : 'pre';
}

function getSetScores(matchUp: any, sideNumber: 1 | 2): number[] {
  const sets = matchUp?.score?.sets;
  if (!Array.isArray(sets)) return [];
  return sets.map((set: any) => Number(set?.[`side${sideNumber}Score`] ?? 0));
}

function buildSide(matchUp: any, sideNumber: 1 | 2): PublicLiveSide {
  const side = (matchUp?.sides ?? []).find((s: any) => s?.sideNumber === sideNumber);
  const participantName = resolveParticipantName(side);
  return {
    teamName: participantName,
    playerName: participantName,
    setScores: getSetScores(matchUp, sideNumber),
    gameScore: undefined,
    isServing: false,
  };
}

function resolveParticipantName(side: any): string {
  if (!side) return '';
  // Direct participant
  const direct = side?.participant?.participantName;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  // Doubles / team — fall back to a comma-joined name list
  const individuals: any[] = side?.participant?.individualParticipants ?? [];
  if (Array.isArray(individuals) && individuals.length > 0) {
    return individuals.map((p) => p?.participantName ?? '').filter(Boolean).join(' / ');
  }
  return '';
}
