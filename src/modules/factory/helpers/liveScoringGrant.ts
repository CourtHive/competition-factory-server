import type { TournamentGrantRow } from 'src/storage/interfaces';
import { grantCoversMethod, isEvaluableScope, isWithinWindow } from './grantScope';

/** A covering grant restricts the operator's independent authority to run setMatchUpStatus. */
export function isLiveScoringGrant(
  grant: TournamentGrantRow,
  userId: string,
  providerId: string,
  tournamentId: string,
) {
  return (
    grant.userId === userId &&
    grant.providerId === providerId &&
    grant.tournamentId === tournamentId &&
    isWithinWindow(grant) &&
    grantCoversMethod(grant.capability, 'setMatchUpStatus') &&
    isEvaluableScope(grant.scope)
  );
}
