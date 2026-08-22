import { participantConstants, participantRoles, queryGovernor } from 'tods-competition-factory';

import type { ITournamentStorage, IProviderStorage } from 'src/storage/interfaces';
import { resolvePublicParticipantPolicy } from './participantPrivacyPolicy';
import { SUCCESS } from 'src/common/constants/app';

const { INDIVIDUAL, PAIR, TEAM } = participantConstants;
const { COMPETITOR } = participantRoles;


/**
 * Staff are excluded by PREDICATE, not by the factory's `participantRoles` filter.
 *
 * That filter is an allow-list: `filterParticipants.ts` keeps a participant only when
 * `participantRole && set.has(participantRole)`, so supplying `[COMPETITOR]` would also drop every
 * participant carrying NO role. `addParticipant` refuses a role-less INDIVIDUAL today, but that guard
 * is recent and not every PAIR-creation path goes through it — so the allow-list could silently empty
 * a published participant list for an older tournament. Same trap as factory #4684, and phrased the
 * same way: "has a role, and it is not COMPETITOR" excludes staff while an absent role stays public.
 *
 * D8 (CA, 2026-08-18): staff belong in `tournamentInfo.tournamentContacts`, never here.
 */
function publicCompetitors(participants?: any[]): any[] | undefined {
  return participants?.filter((p) => !p?.participantRole || p.participantRole === COMPETITOR);
}

export async function getParticipants(
  params,
  tournamentStorage: ITournamentStorage,
  providerStorage?: IProviderStorage,
) {
  const { tournamentId, ...opts } = params ?? {};
  if (!tournamentId) return { error: 'MISSING_TOURNAMENT_ID' };

  const findResult: any = await tournamentStorage.findTournamentRecord({ tournamentId });
  if (findResult.error) return findResult;

  const tournamentRecord = findResult.tournamentRecord;

  const pubStatus = queryGovernor.getTournamentPublishStatus({ tournamentRecord });
  if (!pubStatus?.participants?.published) return { error: 'Participants not published' };

  // One resolver for every public route — see participantPrivacyPolicy.ts. This
  // route's inline version was the ONLY one honouring the provider and an attached
  // policy; the other four used the bare default, which is the divergence
  // getDrawData's header calls a privacy leak.
  const policyDefinitions = await resolvePublicParticipantPolicy({ tournamentRecord, providerStorage });

  const participantResult = queryGovernor.getParticipants({
    policyDefinitions,
    contextFilters: opts?.contextFilters,
    matchUpFilters: opts?.matchUpFilters,
    // GROUP is excluded by TYPE. A GROUP is a relationship primitive — a coach's stable, an
    // avoidance cohort — and shipped publicly it carried its whole member list. Downstream it was
    // rendered as a person: courthive-public listed it in the Players tab and courthive-arena
    // loaded it into the roster cache as a fake player named e.g. "Transport Van A".
    //
    // Excluding by type rather than by role is deliberate: no role is consulted, so nothing here
    // can drop a competitor. TEAM stays — teams compete in team events.
    //
    // Set here rather than forwarded from `opts`, deliberately: a caller must not be able to widen
    // the public audience back to GROUPs.
    participantFilters: { participantTypes: [INDIVIDUAL, PAIR, TEAM] },
    withScaleValues: true,
    usePublishState: true, // filters out events that are not published
    tournamentRecord,
    withEvents: true,
  });
  if (participantResult.error) return participantResult;

  return { ...SUCCESS, participants: publicCompetitors(participantResult?.participants) };
}
