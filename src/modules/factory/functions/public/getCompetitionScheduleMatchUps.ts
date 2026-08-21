import { queryGovernor } from 'tods-competition-factory';

import { publicParticipantPrivacyPolicy } from './participantPrivacyPolicy';
import type { ITournamentStorage } from 'src/storage/interfaces';
import { SUCCESS } from 'src/common/constants/app';

/**
 * ⚠️ This route spreads the factory result wholesale, which includes `mappedParticipants` — the
 * participant lookup courthive-public uses to hydrate schedule rows (`tabDisplay.ts` hard-codes
 * `hydrateParticipants: false`, so the map is always populated for the real client). That map is
 * emitted participant data and is governed by the policy passed below; it was NOT until factory
 * `getTournamentMatchUps` began filtering at the emission boundary, so this route's response is only
 * as private as the factory build it runs against.
 */
export async function getCompetitionScheduleMatchUps(params, storage: ITournamentStorage) {
  const { tournamentId, ...opts } = params ?? {};
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };

  const findResult: any = await storage.fetchTournamentRecords({ tournamentId });
  if (findResult.error) return findResult;

  const tournamentRecords = findResult.tournamentRecords;

  const matchUpsResult = queryGovernor.competitionScheduleMatchUps({
    policyDefinitions: publicParticipantPrivacyPolicy(),
    courtCompletedMatchUps: opts?.courtCompletedMatchUps,
    hydrateParticipants: opts?.hydrateParticipants,
    contextFilters: opts?.contextFilters,
    matchUpFilters: opts?.matchUpFilters,
    activeTournamentId: tournamentId,
    nextMatchUps: opts?.nextMatchUps,
    usePublishState: true,
    tournamentRecords,
  });
  if (matchUpsResult.error) return matchUpsResult;
  return { ...SUCCESS, ...matchUpsResult };
}
