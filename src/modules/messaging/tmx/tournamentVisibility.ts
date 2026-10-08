import { canViewTournament } from 'src/modules/factory/helpers/checkTournamentAccess';

import type { UserContext } from 'src/modules/account/auth/decorators/user-context.decorator';
import type { TournamentStorageService } from 'src/storage/tournament-storage.service';
import type { AssignmentsService } from 'src/modules/factory/assignments.service';

/**
 * Whether a caller may see a tournament's room: who is there and what is said in it. One rule for
 * joining the room and for posting to its chat, on either transport.
 *
 * Deliberately the rule `joinTournament` has always applied, including its two pass-throughs: no
 * user context (the guard has already authenticated the caller), and a tournament with no stored
 * record (one that exists only in a client so far). Tightening either is a separate decision.
 */
export async function userCanViewTournament({
  tournamentId,
  userContext,
  storage,
  assignments,
}: {
  tournamentId: string;
  userContext: UserContext | undefined;
  storage: TournamentStorageService;
  assignments: AssignmentsService;
}): Promise<boolean> {
  if (!userContext) return true;
  const result: any = await storage.fetchTournamentRecords({ tournamentId });
  const tournament = result?.tournamentRecords?.[tournamentId];
  if (!tournament) return true;
  const assignedIds = await assignments.getAssignedTournamentIds(userContext.userId);
  return canViewTournament(tournament, userContext, assignedIds);
}
