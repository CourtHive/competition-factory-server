import { queryGovernor } from 'tods-competition-factory';

import type { ITournamentStorage, IProviderStorage } from 'src/storage/interfaces';
import { resolvePublicParticipantPolicy } from './participantPrivacyPolicy';
import { SUCCESS } from 'src/common/constants/app';


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
    withScaleValues: true,
    usePublishState: true, // filters out events that are not published
    tournamentRecord,
    withEvents: true,
  });
  if (participantResult.error) return participantResult;

  return { ...SUCCESS, participants: participantResult?.participants };
}
