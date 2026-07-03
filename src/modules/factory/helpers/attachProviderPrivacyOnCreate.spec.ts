import { factoryConstants } from 'tods-competition-factory';
import { attachProviderPrivacyOnCreate } from './attachProviderPrivacyOnCreate';

const POLICY_TYPE_PARTICIPANT = factoryConstants.policyConstants.POLICY_TYPE_PARTICIPANT;
const MISSING_TOURNAMENT_RECORD = factoryConstants.errorConditionConstants.MISSING_TOURNAMENT_RECORD;

const PROVIDER_ID = 'priv-provider-1';
const TOURNAMENT_ID = 'save-path-tournament-1';
const privacyPolicy = { policyName: 'Test Privacy', participant: { person: { addresses: false } } };

function makeRecord(overrides: any = {}) {
  return { tournamentId: TOURNAMENT_ID, parentOrganisation: { organisationId: PROVIDER_ID }, ...overrides };
}

// storage that reports the tournament does NOT yet exist → creation
const notFoundStorage = {
  fetchTournamentUpdatedAt: jest.fn().mockResolvedValue({ error: MISSING_TOURNAMENT_RECORD }),
};
// storage that reports the tournament DOES exist → edit-save
const existsStorage = {
  fetchTournamentUpdatedAt: jest.fn().mockResolvedValue({ success: true, updatedAt: '2026-07-01T00:00:00Z' }),
};

const providerWithPolicy = {
  getProvider: jest.fn().mockResolvedValue({ caps: {}, settings: { participantPrivacyPolicy: privacyPolicy } }),
};

function participantPolicyOn(record: any) {
  const applied = record?.extensions?.find((e: any) => e.name === 'appliedPolicies')?.value;
  return applied?.[POLICY_TYPE_PARTICIPANT];
}

describe('attachProviderPrivacyOnCreate (REST /factory/save create path)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('attaches the provider privacy policy on creation (tournament not yet in storage)', async () => {
    const record = makeRecord();
    const attached = await attachProviderPrivacyOnCreate(record, {
      tournamentStorageService: notFoundStorage as any,
      providerStorage: providerWithPolicy as any,
    });
    expect(attached).toBe(true);
    expect(participantPolicyOn(record)).toEqual(privacyPolicy);
  });

  it('does NOT attach on an edit-save (tournament already exists)', async () => {
    const record = makeRecord();
    const attached = await attachProviderPrivacyOnCreate(record, {
      tournamentStorageService: existsStorage as any,
      providerStorage: providerWithPolicy as any,
    });
    expect(attached).toBe(false);
    expect(providerWithPolicy.getProvider).not.toHaveBeenCalled();
    expect(participantPolicyOn(record)).toBeUndefined();
  });

  it('does NOT attach when the record already carries a participant policy (hot path — no storage call)', async () => {
    const record = makeRecord({
      extensions: [{ name: 'appliedPolicies', value: { [POLICY_TYPE_PARTICIPANT]: privacyPolicy } }],
    });
    const attached = await attachProviderPrivacyOnCreate(record, {
      tournamentStorageService: notFoundStorage as any,
      providerStorage: providerWithPolicy as any,
    });
    expect(attached).toBe(false);
    expect(notFoundStorage.fetchTournamentUpdatedAt).not.toHaveBeenCalled();
  });

  it('skips records with no owning provider', async () => {
    const record = makeRecord({ parentOrganisation: undefined });
    const attached = await attachProviderPrivacyOnCreate(record, {
      tournamentStorageService: notFoundStorage as any,
      providerStorage: providerWithPolicy as any,
    });
    expect(attached).toBe(false);
    expect(notFoundStorage.fetchTournamentUpdatedAt).not.toHaveBeenCalled();
  });

  it('does NOT attach when the provider has no privacy policy configured', async () => {
    const record = makeRecord();
    const bareProvider = { getProvider: jest.fn().mockResolvedValue({ caps: {}, settings: {} }) };
    const attached = await attachProviderPrivacyOnCreate(record, {
      tournamentStorageService: notFoundStorage as any,
      providerStorage: bareProvider as any,
    });
    expect(attached).toBe(false);
    expect(participantPolicyOn(record)).toBeUndefined();
  });

  it('does NOT attach on an uncertain existence check (non-missing storage error)', async () => {
    const record = makeRecord();
    const erroringStorage = { fetchTournamentUpdatedAt: jest.fn().mockResolvedValue({ error: 'DB_DOWN' }) };
    const attached = await attachProviderPrivacyOnCreate(record, {
      tournamentStorageService: erroringStorage as any,
      providerStorage: providerWithPolicy as any,
    });
    expect(attached).toBe(false);
    expect(providerWithPolicy.getProvider).not.toHaveBeenCalled();
  });
});
