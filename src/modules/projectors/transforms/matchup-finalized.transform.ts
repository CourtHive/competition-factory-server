/**
 * Phase 3 slice 6 — crowd writes.
 *
 * The `matchup-finalized` consumer fires a fire-and-forget POST to
 * score-relay's `/api/internal/matchup-finalized` endpoint whenever a
 * CFS mutation finalizes a matchUp. Score-relay uses that signal to
 * cancel any active crowd-scoring sessions for the matchUp (the
 * authoritative score has now landed in the tournament record).
 *
 * Detection criteria — a matchUp is finalized when EITHER:
 *
 *   - `winningSide` is set to 1 or 2, OR
 *   - `matchUpStatus === 'COMPLETED'`
 *
 * Both fields ride on the `MODIFY_MATCHUP` public notice that
 * `getMutationEngine.ts` already emits per mutation, so detection costs
 * nothing extra — we just filter the notices we're already iterating.
 *
 * The payload sent to score-relay is intentionally minimal: just the
 * matchUpId. Score-relay does its own lookup; CFS owns no crowd data
 * (Decision 6 — CFS stays out of the crowd data path entirely).
 */

export interface MatchUpFinalizedPayload {
  matchUpId: string;
}

interface MatchUpNoticeLike {
  matchUp?: {
    matchUpId?: string;
    matchUpStatus?: string;
    winningSide?: number | null;
  };
}

export function isFinalizingNotice(notice: MatchUpNoticeLike | undefined | null): boolean {
  const matchUp = notice?.matchUp;
  if (!matchUp?.matchUpId) return false;
  if (matchUp.winningSide === 1 || matchUp.winningSide === 2) return true;
  if (matchUp.matchUpStatus === 'COMPLETED') return true;
  return false;
}

export function buildMatchUpFinalizedPayload(
  notice: MatchUpNoticeLike | undefined | null,
): MatchUpFinalizedPayload | null {
  if (!isFinalizingNotice(notice)) return null;
  const matchUpId = notice?.matchUp?.matchUpId;
  if (!matchUpId) return null;
  return { matchUpId };
}
