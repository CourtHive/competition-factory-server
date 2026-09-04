import { fixtures, queryGovernor, factoryConstants } from 'tods-competition-factory';

import { computeEffectiveConfig, type ProviderParticipantPrivacy } from '@courthive/provider-config';
import type { IProviderStorage } from 'src/storage/interfaces';

const POLICY_TYPE_PARTICIPANT = factoryConstants.policyConstants.POLICY_TYPE_PARTICIPANT;

/**
 * The participant privacy policy every public route runs under — always as a FRESH COPY.
 *
 * `fixtures.policies.POLICY_PRIVACY_DEFAULT` is a module-level object exported by the factory and
 * shared by every consumer in this process. Three public routes used to widen it IN PLACE
 * (`person.sex = true`, plus `rankings` / `ratings` / `seedings` / `teams`), so the first request to
 * any of them permanently loosened the policy for every other reader in the process — including
 * `getCompetitionScheduleMatchUps`, which had never asked for any of it. Measured on a live control:
 * `person.sex` present 0/8 before one `getEventData` call, 8/8 after.
 *
 * Handing out a copy makes that class of defect impossible rather than merely absent: a call site can
 * mutate what it receives and reach nobody else. If a route genuinely needs a variant, mutate the copy
 * — never the fixture, and never with `JSON.parse(JSON.stringify(...))`.
 *
 * The widened attributes were removed rather than preserved on the copy. `rankings` and `ratings` were
 * already `true` in the default, so those two lines had never done anything. `seedings` is opt-in via
 * `participantsProfile.withSeeding`, which no route here requests, and `getDrawData` / `getStructureData`
 * emit none under any policy.
 *
 * ⚠️ `person.sex` and `teams` are a different case — do NOT read their removal as "nobody needs this".
 * Removing them is safe *today*: the only consumer is courthive-public's name colouring, which loses a
 * tint, and the ITA duals carry no `person.sex` at all (`courthive-ingest/packages/ingest-runner/scripts/dual-to-codes.mjs:168`
 * builds a person with `personId` and the two standard names, never `sex`). But the ITA **requires**
 * gender to pass through, so it has to come back — as a **provider-scoped policy**, never as a global
 * widening of the shared default applied to every provider to satisfy one of them. That is the hack this
 * file exists to remove, and re-permitting `person.sex` on the copy would be the same hack with better
 * hygiene. `POLICY_PRIVACY_DEFAULT` keeps `sex: false` deliberately.
 *
 * The plumbing that requirement needs does not exist yet — provider-scoped policy never reaches the read
 * path (attached only on `newTournamentRecord`; the emission boundary reads the `policyDefinitions`
 * PARAM and never `getAppliedPolicies`). That gap is why someone reached for the shared fixture in the
 * first place. See `Mentat/planning/ITA_GENDER_AND_PRIVACY_POLICY.md`.
 */
export function publicParticipantPrivacyPolicy(): any {
  return structuredClone(fixtures.policies.POLICY_PRIVACY_DEFAULT);
}

/**
 * THE participant-privacy policy for every public route. One function, because the
 * routes are required to agree.
 *
 * `getDrawData`'s own header states the invariant: "a public reader must not see more
 * through the draw route than through the event route. Any divergence here is a
 * privacy leak, not a formatting difference." That agreement was maintained by hand
 * across five routes — and had already broken: `getParticipants` resolved the owning
 * provider and honoured a policy attached to the tournamentRecord, while
 * `getEventData` / `getDrawData` / `getStructureData` /
 * `getCompetitionScheduleMatchUps` used the bare default and resolved nothing. A
 * provider that had opted into an attribute got it through one route and not the
 * others.
 *
 * Precedence, and it matters:
 *
 * 1. A policy ATTACHED to the tournamentRecord wins. It is stamped at creation and by
 *    "apply to existing", and it is the provider's explicit selection.
 * 2. Otherwise the provider's `participantPrivacy` toggles build a variant ON A COPY.
 * 3. Otherwise the shipped default, which strips.
 *
 * **Fails closed at every branch.** An unresolvable provider, a storage that was not
 * passed, or a thrown lookup all fall through to the default — the strictest option.
 * Widening privacy because a lookup failed is the one outcome that must be impossible.
 */
export async function resolvePublicParticipantPolicy({
  tournamentRecord,
  providerStorage,
}: {
  tournamentRecord: any;
  providerStorage?: IProviderStorage;
}): Promise<any> {
  const attached = queryGovernor.getPolicyDefinitions({
    tournamentRecord,
    policyTypes: [POLICY_TYPE_PARTICIPANT],
  })?.policyDefinitions;
  if (attached?.[POLICY_TYPE_PARTICIPANT]) return attached;

  let privacy: ProviderParticipantPrivacy | undefined;
  const providerId = tournamentRecord?.parentOrganisation?.organisationId;
  if (providerId && providerStorage) {
    try {
      const provider: any = await providerStorage.getProvider(providerId);
      privacy = computeEffectiveConfig(provider?.providerConfigCaps, provider?.providerConfigSettings)
        ?.participantPrivacy;
    } catch {
      // Fall through to the default-strict policy. Never widen on failure.
    }
  }

  return buildParticipantPrivacyPolicy(privacy);
}

/**
 * Build a variant of the default that opens exactly the attributes a provider has
 * been granted — always on a COPY, never on the shared fixture.
 *
 * ⚠️ Every attribute must be opened in BOTH person blocks: the top-level
 * `participant.person` and `participant.individualParticipants.person`. Opening only
 * the first serves a standalone INDIVIDUAL correctly and strips the members of a PAIR
 * or TEAM — invisible until someone looks at a doubles rubber, and the exact asymmetry
 * the emission-boundary work existed to remove.
 */
export function buildParticipantPrivacyPolicy(privacy?: ProviderParticipantPrivacy): any {
  const policy = publicParticipantPrivacyPolicy();
  const template = policy[POLICY_TYPE_PARTICIPANT];
  const personBlocks = [template?.participant?.person, template?.participant?.individualParticipants?.person].filter(
    Boolean,
  );

  if (privacy?.cityState) {
    // Only city/state — `attributeFilter` copies exactly what the template names, so
    // street and postal code stay stripped.
    for (const person of personBlocks) person.addresses = { city: true, state: true };
  }

  if (privacy?.sex) {
    for (const person of personBlocks) person.sex = true;
  }

  return policy;
}

/**
 * Resolve the event owning a draw.
 *
 * `getDrawData` and `getStructureData` used to destructure `event` out of
 * `queryGovernor.findDrawDefinition(...)`, but that export is `publicFindDrawDefinition`, which returns
 * `{ drawDefinition }` and nothing else — the `as any` at the call site is what stopped the compiler
 * from saying so. With `event: undefined` and `usePublishState: true`, the factory computed
 * `eventPublished === false` and withheld `structures`, so both routes returned draw metadata and no
 * draw, always. Nothing consumed them yet (added in #906), which is why it went unnoticed.
 *
 * Resolved here from the record CFS already holds rather than by widening the factory's public export,
 * so the fix needs no publish. Publish-state gating remains the guard: with the event resolved,
 * `drawPublished` is computed honestly and an unpublished draw still yields no structures.
 */
export function findEventForDraw(tournamentRecord: any, drawId: string): any {
  return (tournamentRecord?.events ?? []).find((event: any) =>
    (event?.drawDefinitions ?? []).some((drawDefinition: any) => drawDefinition?.drawId === drawId),
  );
}
