import { fixtures } from 'tods-competition-factory';

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
 * tint, and the ITA duals carry no `person.sex` at all (`courthive-ingest/scripts/dual-to-codes.mjs:168`
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
