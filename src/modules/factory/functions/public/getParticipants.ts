import { fixtures, queryGovernor, factoryConstants } from 'tods-competition-factory';

import { computeEffectiveConfig } from 'src/modules/providers/effective-provider-config';
import type { ProviderParticipantPrivacy } from 'src/modules/providers/provider-config.types';
import type { ITournamentStorage, IProviderStorage } from 'src/storage/interfaces';
import { SUCCESS } from 'src/common/constants/app';

const POLICY_TYPE_PARTICIPANT = factoryConstants.policyConstants.POLICY_TYPE_PARTICIPANT;

/**
 * Build a participant privacy policy that respects the owning provider's
 * `participantPrivacy` cap. By default we use `POLICY_PRIVACY_DEFAULT`
 * which strips `addresses` entirely; if the provider opts in to
 * `cityState`, we relax the policy to allow only `city` and `state`
 * sub-fields (full street / postal code / etc. stay stripped because
 * `attributeFilter` only copies the fields explicitly named in the
 * template).
 */
function buildParticipantPrivacyPolicy(privacy?: ProviderParticipantPrivacy) {
  const policy = JSON.parse(JSON.stringify(fixtures.policies.POLICY_PRIVACY_DEFAULT));

  if (privacy?.cityState) {
    const allowedAddressFields = { city: true, state: true };
    const template = policy[POLICY_TYPE_PARTICIPANT];
    if (template?.participant?.person) {
      template.participant.person.addresses = allowedAddressFields;
    }
    if (template?.participant?.individualParticipants?.person) {
      template.participant.individualParticipants.person.addresses = allowedAddressFields;
    }
  }

  return policy;
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

  // Resolve the tournament's owning provider to look up its participantPrivacy
  // cap. Privacy is provider-level: the cap controls which otherwise-stripped
  // attributes (city/state today, gender later) flow through to the public
  // payload. Default ceiling = privacy-first (strip everything that
  // POLICY_PRIVACY_DEFAULT strips) when the provider isn't resolvable or
  // hasn't opted in.
  let participantPrivacy: ProviderParticipantPrivacy | undefined;
  const providerId = tournamentRecord?.parentOrganisation?.organisationId;
  if (providerId && providerStorage) {
    try {
      const provider = await providerStorage.getProvider(providerId);
      const effective = computeEffectiveConfig(provider?.caps, provider?.settings);
      participantPrivacy = effective.participantPrivacy;
    } catch {
      // Provider lookup failure → fall through to default-strict policy.
    }
  }

  const policyDefinitions = buildParticipantPrivacyPolicy(participantPrivacy);

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
