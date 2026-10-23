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
  PUBLIC_TEAM_TEMPLATE,
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
    getProvider: vi.fn().mockResolvedValue({
      providerConfigCaps: { participantPrivacy: { sex } },
      providerConfigSettings: { participantPrivacy: { cityState } },
    }),
  };
}

const participantBlocks = (policy: any) => [
  policy[POLICY_TYPE_PARTICIPANT].participant,
  policy[POLICY_TYPE_PARTICIPANT].participant.individualParticipants,
];

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
    const providerStorage: any = { getProvider: vi.fn().mockRejectedValue(new Error('db down')) };
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
    // returned as the provider chose it: `teams` is not added to an attached policy
    expect(policy).toEqual(attached);
  });

  it('does NOT open a settings-tier toggle declared on caps, or vice versa', async () => {
    // The tiers are not interchangeable, and a mis-tiered toggle fails CLOSED.
    const capsOnlyCityState: any = {
      getProvider: vi.fn().mockResolvedValue({
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

  it('never mutates the shared fixture when a caller changes the policy it was handed', () => {
    const before = JSON.stringify(fixtures.policies.POLICY_PRIVACY_DEFAULT);
    const policy = buildParticipantPrivacyPolicy({ cityState: true, sex: true } as any);
    for (const block of participantBlocks(policy)) {
      block.teams.participantName = false;
      block.teams.contacts = true;
    }
    expect(JSON.stringify(fixtures.policies.POLICY_PRIVACY_DEFAULT)).toBe(before);
    // Since factory 7.20.0 the fixture names `teams` itself, so the copy's `teams` must be its own object in
    // both blocks: sharing the fixture's would have let the writes above reach every reader in the process.
    const fixture: any = fixtures.policies.POLICY_PRIVACY_DEFAULT;
    const fixtureBlocks = [
      fixture[POLICY_TYPE_PARTICIPANT].participant,
      fixture[POLICY_TYPE_PARTICIPANT].participant.individualParticipants,
    ];
    participantBlocks(policy).forEach((block, i) => expect(block.teams).not.toBe(fixtureBlocks[i].teams));
    expect(participantBlocks(publicParticipantPrivacyPolicy())[0].teams).toEqual(PUBLIC_TEAM_TEMPLATE);
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

describe('teams: a school is public, in both participant blocks, under every provider toggle', () => {
  // courthive-components `renderTeam` reads `individualParticipant.teams[0].participantName`. Without
  // `teams` in the policy the factory's attribute filter drops it and the public draw shows a blank line
  // where the school belongs (0 of 138 INDIVIDUALs on a live ITA regional).
  it('the default public policy opens the limited team shape in both blocks', () => {
    for (const block of participantBlocks(publicParticipantPrivacyPolicy())) {
      expect(block.teams).toEqual({
        participantId: true,
        participantName: true,
        participantOtherName: true,
        participantType: true,
      });
    }
  });

  it.each([
    ['no toggles', undefined],
    ['{}', {}],
    ['{ sex: true }', { sex: true }],
    ['{ cityState: true }', { cityState: true }],
    ['both', { sex: true, cityState: true }],
  ])('survives buildParticipantPrivacyPolicy with %s', (_label, privacy) => {
    const policy = buildParticipantPrivacyPolicy(privacy as any);
    for (const block of participantBlocks(policy)) expect(block.teams).toEqual(PUBLIC_TEAM_TEMPLATE);
  });

  it('never names team contacts, online resources, members or person data', () => {
    for (const forbidden of [
      'contacts',
      'onlineResources',
      'individualParticipantIds',
      'person',
      'participantRoleResponsibilities',
    ]) {
      expect(Object.keys(PUBLIC_TEAM_TEMPLATE)).not.toContain(forbidden);
    }
  });

  it('opening teams leaves person.sex closed by default', () => {
    for (const person of personBlocks(publicParticipantPrivacyPolicy())) expect(person.sex).toBe(false);
  });
});
