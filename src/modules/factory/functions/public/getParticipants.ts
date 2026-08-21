import { queryGovernor, factoryConstants } from 'tods-competition-factory';

import { computeEffectiveConfig, type ProviderParticipantPrivacy } from '@courthive/provider-config';
import type { ITournamentStorage, IProviderStorage } from 'src/storage/interfaces';
import { publicParticipantPrivacyPolicy } from './participantPrivacyPolicy';
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
  // A variant, so it must be built on a COPY. `publicParticipantPrivacyPolicy()` returns one; this
  // used `JSON.parse(JSON.stringify(...))`, which is the idiom being retired ecosystem-wide.
  const policy = publicParticipantPrivacyPolicy();

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
      const effective = computeEffectiveConfig(provider?.providerConfigCaps, provider?.providerConfigSettings);
      participantPrivacy = effective.participantPrivacy;
    } catch {
      // Provider lookup failure → fall through to default-strict policy.
    }
  }

  // Prefer a participant-privacy POLICY attached to the tournamentRecord. The
  // provider's selected privacy policy is attached on tournament creation (and
  // via "apply to existing"), and the factory applies it during participant
  // filtering. Only when no policy is attached do we fall back to the legacy
  // participantPrivacy toggle → default-strict policy.
  const attached = queryGovernor.getPolicyDefinitions({
    tournamentRecord,
    policyTypes: [POLICY_TYPE_PARTICIPANT],
  })?.policyDefinitions;

  const policyDefinitions = attached?.[POLICY_TYPE_PARTICIPANT]
    ? attached
    : buildParticipantPrivacyPolicy(participantPrivacy);

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
