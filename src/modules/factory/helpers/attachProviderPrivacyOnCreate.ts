import { queryGovernor, policyGovernor, factoryConstants } from 'tods-competition-factory';
import { computeEffectiveConfig } from '@courthive/provider-config';

import type { TournamentStorageService } from 'src/storage/tournament-storage.service';
import type { IProviderStorage } from 'src/storage/interfaces';

const POLICY_TYPE_PARTICIPANT = factoryConstants.policyConstants.POLICY_TYPE_PARTICIPANT;
const MISSING_TOURNAMENT_RECORD = factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD;

type Deps = {
  tournamentStorageService: Pick<TournamentStorageService, 'fetchTournamentUpdatedAt'>;
  providerStorage: Pick<IProviderStorage, 'getProvider'>;
};

/**
 * Attach the owning provider's participant-privacy policy to a tournament
 * record, but ONLY on creation. Used by the TMX UI create path
 * (sendTournament → POST /factory/save → FactoryService.saveTournamentRecords),
 * mirroring the executionQueue create hook for the API/provisioner path.
 *
 * Skips (returns false) when:
 *  - the record has no owning provider or no tournamentId,
 *  - it already carries a participant policy (the hot path — every tournament
 *    created after this feature already has it),
 *  - it already exists in storage (an edit-save; never force a privacy change
 *    on an in-flight tournament without acknowledgment), or
 *  - the provider has no participant-privacy policy configured.
 *
 * Any storage error other than "missing tournament" also aborts — we never
 * attach on an uncertain existence check. Mutates the record's APPLIED_POLICIES
 * extension in place. Returns true iff a policy was attached.
 */
export async function attachProviderPrivacyOnCreate(record: any, deps: Deps): Promise<boolean> {
  const providerId = record?.parentOrganisation?.organisationId;
  const tournamentId = record?.tournamentId;
  if (!providerId || !tournamentId) return false;

  const existingPolicy = queryGovernor.getPolicyDefinitions({
    tournamentRecord: record,
    policyTypes: [POLICY_TYPE_PARTICIPANT],
  })?.policyDefinitions?.[POLICY_TYPE_PARTICIPANT];
  if (existingPolicy) return false;

  // Creation gate: attach only when the tournament positively does not yet
  // exist. A success (updatedAt present) means edit-save; any other error
  // means we can't confirm creation → skip.
  const existing: any = await deps.tournamentStorageService.fetchTournamentUpdatedAt({ tournamentId });
  if (existing?.error !== MISSING_TOURNAMENT_RECORD) return false;

  const provider: any = await deps.providerStorage.getProvider(providerId);
  const policy = computeEffectiveConfig(provider?.providerConfigCaps, provider?.providerConfigSettings)?.participantPrivacyPolicy;
  if (!policy || !Object.keys(policy).length) return false;

  const result: any = policyGovernor.attachPolicies({
    tournamentRecord: record,
    policyDefinitions: { [POLICY_TYPE_PARTICIPANT]: policy },
  });
  return !!result?.success;
}
