// The single privacy resolver every public route now shares.
//
// It exists because the routes are REQUIRED to agree — `getDrawData`'s own header
// says "a public reader must not see more through the draw route than through the
// event route. Any divergence here is a privacy leak, not a formatting difference."
// That agreement was hand-maintained across five routes and had already broken:
// only `getParticipants` resolved the owning provider or honoured an attached
// policy. These tests pin the contract in one place so it cannot drift again.

import { fixtures, factoryConstants } from 'tods-competition-factory';

import {
  buildParticipantPrivacyPolicy,
  publicParticipantPrivacyPolicy,
  resolvePublicParticipantPolicy,
} from './participantPrivacyPolicy';

const POLICY_TYPE_PARTICIPANT = factoryConstants.policyConstants.POLICY_TYPE_PARTICIPANT;

const PROVIDER_ID = 'provider-1';

function record(overrides: Record<string, any> = {}) {
  return { parentOrganisation: { organisationId: PROVIDER_ID }, ...overrides };
}

/**
 * A provider whose effective config carries the given privacy toggles.
 *
 * The two toggles live on DIFFERENT tiers, deliberately: `cityState` keeps its
 * original settings-only rule so nothing relying on it moved, while `sex` is
 * caps-gated because the ITA is one provisioner over ~1,032 schools that will not
 * each configure their own. Putting either on the wrong tier yields `false` —
 * which is how this helper was wrong on first write.
 */
function storageWith({ cityState, sex }: { cityState?: boolean; sex?: boolean }): any {
  return {
    getProvider: jest.fn().mockResolvedValue({
      providerConfigCaps: { participantPrivacy: { sex } },
      providerConfigSettings: { participantPrivacy: { cityState } },
    }),
  };
}

const personBlocks = (policy: any) => [
  policy[POLICY_TYPE_PARTICIPANT].participant.person,
  policy[POLICY_TYPE_PARTICIPANT].participant.individualParticipants.person,
];

describe('resolvePublicParticipantPolicy', () => {
  it('defaults to the strict shipped policy when there is no provider', async () => {
    const policy = await resolvePublicParticipantPolicy({ tournamentRecord: {}, providerStorage: undefined });
    expect(policy).toEqual(publicParticipantPrivacyPolicy());
  });

  it('fails CLOSED when the provider lookup throws', async () => {
    // Widening privacy because a lookup failed is the one outcome that must be
    // impossible. A thrown storage call must not become "no restrictions".
    //
    // Asserts the WHOLE policy equals the shipped default, not one attribute.
    // The first version of this test checked only `person.sex`, and a
    // falsification probe that widened `addresses` on failure passed it — a
    // fail-open bug slipping through the test named for catching it. An
    // exact-match is the only assertion that covers every attribute at once.
    const providerStorage: any = { getProvider: jest.fn().mockRejectedValue(new Error('db down')) };
    const policy = await resolvePublicParticipantPolicy({ tournamentRecord: record(), providerStorage });
    expect(policy).toEqual(publicParticipantPrivacyPolicy());
  });

  it('fails CLOSED when no providerStorage was passed at all', async () => {
    // A route that forgets to thread it gets the strict policy, not an open one.
    const policy = await resolvePublicParticipantPolicy({ tournamentRecord: record() });
    expect(policy).toEqual(publicParticipantPrivacyPolicy());
  });

  it('prefers a policy ATTACHED to the tournamentRecord over the provider toggles', async () => {
    // The attached policy is the provider's explicit selection; toggles are the
    // fallback. If this inverts, "apply to existing" silently stops taking effect.
    const attached = { [POLICY_TYPE_PARTICIPANT]: { policyName: 'Attached', participant: { participantName: true } } };
    const tournamentRecord = record({
      extensions: [{ name: 'appliedPolicies', value: attached }],
    });
    const providerStorage = storageWith({ cityState: true });
    const policy = await resolvePublicParticipantPolicy({ tournamentRecord, providerStorage });
    expect(policy[POLICY_TYPE_PARTICIPANT].policyName).toBe('Attached');
    expect(providerStorage.getProvider).not.toHaveBeenCalled();
  });

  it('does NOT open a settings-tier toggle declared on caps, or vice versa', async () => {
    // The tiers are not interchangeable, and a mis-tiered toggle fails CLOSED.
    const capsOnlyCityState: any = {
      getProvider: jest.fn().mockResolvedValue({
        providerConfigCaps: { participantPrivacy: { cityState: true } },
        providerConfigSettings: {},
      }),
    };
    const policy = await resolvePublicParticipantPolicy({
      tournamentRecord: record(),
      providerStorage: capsOnlyCityState,
    });
    for (const person of personBlocks(policy)) expect(person.addresses).toBe(false);
  });

  it('opens cityState from the provider toggles, on both person blocks', async () => {
    const policy = await resolvePublicParticipantPolicy({
      tournamentRecord: record(),
      providerStorage: storageWith({ cityState: true }),
    });
    for (const person of personBlocks(policy)) {
      expect(person.addresses).toEqual({ city: true, state: true });
    }
  });

  it('opens person.sex for a provider whose provisioner enabled it — the ITA case', async () => {
    // The requirement CA stated: the ITA privacy policy need only open person.sex.
    // Both blocks, because the ITA corpus is TEAM duals with PAIR collections, so
    // most individuals are reached through `individualParticipants`.
    const policy = await resolvePublicParticipantPolicy({
      tournamentRecord: record(),
      providerStorage: storageWith({ sex: true }),
    });
    for (const person of personBlocks(policy)) expect(person.sex).toBe(true);
  });

  it('opens ONLY sex — enabling it must not widen anything else', async () => {
    // Guards the difference between "open one attribute" and "relax the policy".
    const policy = await resolvePublicParticipantPolicy({
      tournamentRecord: record(),
      providerStorage: storageWith({ sex: true }),
    });
    const strict = publicParticipantPrivacyPolicy();
    for (const person of personBlocks(strict)) person.sex = true;
    expect(policy).toEqual(strict);
  });

  it('never mutates the shared factory fixture', async () => {
    // The defect this whole area exists to prevent: the first public request used
    // to widen POLICY_PRIVACY_DEFAULT in place for the life of the process.
    const before = JSON.stringify(fixtures.policies.POLICY_PRIVACY_DEFAULT);
    await resolvePublicParticipantPolicy({
      tournamentRecord: record(),
      providerStorage: storageWith({ cityState: true, sex: true }),
    });
    expect(JSON.stringify(fixtures.policies.POLICY_PRIVACY_DEFAULT)).toBe(before);
  });

  it('returns an independent copy per call', async () => {
    const a = await resolvePublicParticipantPolicy({ tournamentRecord: {} });
    const b = await resolvePublicParticipantPolicy({ tournamentRecord: {} });
    a[POLICY_TYPE_PARTICIPANT].participant.person.sex = true;
    expect(b[POLICY_TYPE_PARTICIPANT].participant.person.sex).toBe(false);
  });
});

describe('buildParticipantPrivacyPolicy — both person blocks or none', () => {
  it('opens an attribute in the nested individualParticipants block too', async () => {
    // Opening only the top-level block serves a standalone INDIVIDUAL and strips
    // the members of a PAIR or TEAM — invisible until someone looks at a doubles
    // rubber, and the exact asymmetry the emission-boundary work removed. The ITA
    // corpus is TEAM duals with PAIR collections, so this is the common case.
    const policy = buildParticipantPrivacyPolicy({ cityState: true } as any);
    const [top, nested] = personBlocks(policy);
    expect(top.addresses).toEqual({ city: true, state: true });
    expect(nested.addresses).toEqual({ city: true, state: true });
  });

  it('leaves everything closed when the provider has no toggles', () => {
    const policy = buildParticipantPrivacyPolicy(undefined);
    for (const person of personBlocks(policy)) {
      expect(person.sex).toBe(false);
      expect(person.addresses).toBe(false);
    }
  });
});
