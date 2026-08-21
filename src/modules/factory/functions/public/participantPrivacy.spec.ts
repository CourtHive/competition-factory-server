/**
 * Participant privacy conformance for the four public, unauthenticated, CACHED routes.
 *
 * Until now none of `getEventData`, `getDrawData`, `getStructureData` or
 * `getCompetitionScheduleMatchUps` had a spec of any kind, and no test anywhere in this repo asserted
 * that a public response omits `person.sex`. That gap — not the mutation it hid — is what let three of
 * these routes widen the shared `POLICY_PRIVACY_DEFAULT` fixture in place for two and a half years.
 *
 * So the assertion here names no attribute. It derives what is forbidden from the policy itself and
 * requires that none of it appear anywhere in the response, at any depth. A `sex`-only assertion would
 * pass the next time a different attribute was widened.
 *
 * The factory carries the same check over the engine surfaces (`factory/src/tests/policies/privacy/`).
 * This file is the route tier: it proves each route hands the factory an UNMUTATED policy and returns
 * only what that policy permits.
 */
import { mocksEngine, tournamentEngine, tools, fixtures } from 'tods-competition-factory';

import { getCompetitionScheduleMatchUps } from './getCompetitionScheduleMatchUps';
import { getStructureData } from './getStructureData';
import { getEventData } from './getEventData';
import { getDrawData } from './getDrawData';

import type { ITournamentStorage } from 'src/storage/interfaces';

const TEST_TID = 'test-public-participant-privacy';
const DRAW_ID = 'public-privacy-draw';
const START_DATE = '2024-01-01';
const VENUE_ID = 'public-privacy-venue';

/**
 * Attributes the engine staples onto `sides[].participant` AFTER filtering: they describe the entry
 * into a draw, not the participant. Mirrors the factory suite's list.
 */
const CONTEXT_ANNOTATIONS = new Set(['entryStatus', 'entryStage', 'luckyAdvancement']);

/** Everything the policy strips from a participant, as `{ attribute, value }` pairs to hunt for. */
function forbiddenData(participants: any[], template: any) {
  const forbidden: { attribute: string; value: any }[] = [];
  const walk = (source: any, permitted: any) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    for (const [attribute, value] of Object.entries(source)) {
      const allowed = permitted && typeof permitted === 'object' ? permitted[attribute] : undefined;
      if (allowed === undefined) {
        if (value !== undefined && value !== null && value !== '' && value !== false) {
          forbidden.push({ attribute, value });
        }
      } else if (Array.isArray(value) && Array.isArray(allowed)) {
        value.forEach((member, index) => walk(member, allowed[index]));
      } else if (value && typeof value === 'object') {
        walk(value, allowed);
      }
    }
  };
  for (const participant of participants) walk(participant, tools.attributeFilter({ source: participant, template }));
  return forbidden;
}

const sameValue = (a: any, b: any): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Every place a forbidden datum reappears in the response, with the path it was found at. */
function findLeaks(node: any, forbidden: { attribute: string; value: any }[]) {
  const leaks: string[] = [];
  const seen = new WeakSet();
  let objectsScanned = 0;

  const visit = (value: any, path: string) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) return value.forEach((member, index) => visit(member, `${path}[${index}]`));
    objectsScanned += 1;
    for (const [attribute, attributeValue] of Object.entries(value)) {
      if (forbidden.some((datum) => datum.attribute === attribute && sameValue(datum.value, attributeValue))) {
        leaks.push(`${attribute} @ ${path}`);
      }
      visit(attributeValue, `${path}.${attribute}`);
    }
  };
  visit(node, '$');
  return { leaks, objectsScanned };
}

/** Participants in the response carrying an attribute the policy would have dropped. */
function unpermittedAttributes(node: any, template: any) {
  const findings: string[] = [];
  const seen = new WeakSet();
  let participantsScanned = 0;

  const dropped = (source: any, permitted: any, path: string) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    for (const [attribute, value] of Object.entries(source)) {
      const attributePath = path ? `${path}.${attribute}` : attribute;
      const allowed = permitted && typeof permitted === 'object' ? permitted[attribute] : undefined;
      if (allowed === undefined) {
        if (value !== undefined && !CONTEXT_ANNOTATIONS.has(attributePath)) findings.push(attributePath);
      } else if (Array.isArray(value) && Array.isArray(allowed)) {
        value.forEach((member, index) => dropped(member, allowed[index], `${attributePath}[${index}]`));
      } else if (value && typeof value === 'object') {
        dropped(value, allowed, attributePath);
      }
    }
  };

  const visit = (value: any) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) return value.forEach(visit);
    if (value.participantId && (value.participantType || value.person || value.participantName)) {
      participantsScanned += 1;
      dropped(value, tools.attributeFilter({ source: value, template }), '');
      return;
    }
    // tournamentContacts is governed by POLICY_PRIVACY_STAFF, a different policy for a different
    // population — asserted in the factory suite (staffContacts.test.ts), not judged here.
    for (const [attribute, attributeValue] of Object.entries(value)) {
      if (attribute !== 'tournamentContacts') visit(attributeValue);
    }
  };
  visit(node);
  return { findings, participantsScanned };
}

function buildRecord() {
  const { tournamentRecord, eventIds } = mocksEngine.generateTournamentRecord({
    tournamentAttributes: { tournamentId: TEST_TID },
    drawProfiles: [{ drawSize: 8, drawId: DRAW_ID, drawName: 'Singles' }],
    venueProfiles: [{ venueId: VENUE_ID, venueName: 'Courts', startTime: '08:00', endTime: '20:00', courtsCount: 4 }],
    schedulingProfile: [
      { scheduleDate: START_DATE, venues: [{ venueId: VENUE_ID, rounds: [{ drawId: DRAW_ID, roundNumber: 1 }] }] },
    ],
    endDate: '2024-01-03',
    startDate: START_DATE,
    nonRandom: 1,
  });

  // Give every person a value for the attributes the policy denies. Without this, "the response has no
  // birthDate" says nothing, because no participant ever had one.
  for (const participant of tournamentRecord.participants ?? []) {
    Object.assign(participant, {
      contacts: [{ firstName: 'Emergency', lastName: `Contact-${participant.participantId}` }],
      penalties: [{ penaltyId: `p-${participant.participantId}`, notes: `n-${participant.participantId}` }],
      participantRoleResponsibilities: [`RESP-${participant.participantId}`],
    });
    if (participant.person) {
      Object.assign(participant.person, {
        addresses: [{ city: 'Austin', state: 'TX', street: `${participant.participantId} Way` }],
        nativeFamilyName: `Native-${participant.participantId}`,
        tennisId: `tid-${participant.participantId}`,
        birthDate: '1999-09-09',
        sex: 'MALE',
      });
    }
  }

  tournamentEngine.setState(tournamentRecord);
  tournamentEngine.scheduleProfileRounds({ scheduleDates: [START_DATE] });
  tournamentEngine.publishOrderOfPlay();
  for (const eventId of eventIds) tournamentEngine.publishEvent({ eventId });

  const published = tournamentEngine.getTournament().tournamentRecord;
  return { record: published, eventId: eventIds[0] };
}

const { record, eventId } = buildRecord();
const storage = {
  findTournamentRecord: async ({ tournamentId }: any) =>
    tournamentId === TEST_TID ? { tournamentRecord: record } : { error: 'NOT_FOUND' },
  fetchTournamentRecords: async ({ tournamentId }: any) =>
    tournamentId === TEST_TID ? { tournamentRecords: { [TEST_TID]: record } } : { error: 'NOT_FOUND' },
} as unknown as ITournamentStorage;

const template = (fixtures.policies.POLICY_PRIVACY_DEFAULT as any).participant.participant;
const forbidden = forbiddenData(record.participants ?? [], template);

const structureId = record.events[0].drawDefinitions[0].structures[0].structureId;

const routes: [string, () => Promise<any>][] = [
  ['getEventData', () => getEventData({ tournamentId: TEST_TID, eventId }, storage)],
  ['getDrawData', () => getDrawData({ tournamentId: TEST_TID, drawId: DRAW_ID }, storage)],
  ['getStructureData', () => getStructureData({ tournamentId: TEST_TID, drawId: DRAW_ID, structureId }, storage)],
  // courthive-public hard-codes `hydrateParticipants: false` (tabDisplay.ts), which is the mode that
  // populates `mappedParticipants`. Testing the other mode would miss the payload the public gets.
  [
    'getCompetitionScheduleMatchUps',
    () => getCompetitionScheduleMatchUps({ tournamentId: TEST_TID, hydrateParticipants: false }, storage),
  ],
];

describe('public routes honour the participant privacy policy', () => {
  it('the fixture can prove anything: the policy denies attributes the record actually holds', () => {
    const attributes = new Set(forbidden.map((datum) => datum.attribute));
    expect(forbidden.length).toBeGreaterThan(0);
    expect(attributes.has('sex')).toBe(true);
    expect(attributes.has('birthDate')).toBe(true);
    expect(attributes.has('addresses')).toBe(true);
    // and does NOT deny what it permits, or every response would look dirty
    expect(attributes.has('standardFamilyName')).toBe(false);
    expect(attributes.has('participantId')).toBe(false);
  });

  it.each(routes)('%s emits nothing the policy denies', async (_name, invoke) => {
    const response = await invoke();
    expect(response?.error).toBeUndefined();

    const { leaks, objectsScanned } = findLeaks(response, forbidden);
    const { findings, participantsScanned } = unpermittedAttributes(response, template);

    // controls: a scan that examined nothing cannot testify to anything
    expect(objectsScanned).toBeGreaterThan(0);
    expect(participantsScanned).toBeGreaterThan(0);

    expect(leaks).toEqual([]);
    expect(findings).toEqual([]);
  });

  // Falsified: with the in-place widening restored, this test goes red too — because `template` is a
  // live reference to the shared fixture, so a mutating route poisons even the test's own notion of
  // what is forbidden. That is the contamination mechanism, demonstrated from the inside.
  it('the leak detector fires on a planted value — otherwise the assertions above are decoration', () => {
    const planted = { participants: [{ participantId: 'x', participantType: 'INDIVIDUAL', person: { sex: 'MALE' } }] };
    const { leaks } = findLeaks(planted, forbidden);
    expect(leaks.length).toBeGreaterThan(0);
    expect(unpermittedAttributes(planted, template).findings).toContain('person.sex');
  });
});

/**
 * Publish-state gating is the guard on these two routes, and it has to be the REAL guard rather than an
 * accident of the `event` never being resolved. Before `findEventForDraw`, `event` was always
 * `undefined`, so `eventPublished` was always false and `structures` was always withheld — the routes
 * looked private because they returned nothing at all.
 *
 * So both directions are asserted: a published draw yields structures (which the conformance suite
 * above then judges), and an unpublished one yields none.
 */
describe('getDrawData / getStructureData gate on publish state', () => {
  it('a published draw yields structures', async () => {
    const drawData: any = await getDrawData({ tournamentId: TEST_TID, drawId: DRAW_ID }, storage);
    expect(drawData.drawInfo?.drawPublished).toBe(true);
    expect(drawData.structures?.length).toBeGreaterThan(0);

    const structureData: any = await getStructureData(
      { tournamentId: TEST_TID, drawId: DRAW_ID, structureId },
      storage,
    );
    expect(structureData.structure?.structureId).toEqual(structureId);
  });

  it('an unpublished draw yields none — the gate, not an accident of an unresolved event', async () => {
    const unpublished = structuredClone(record);
    tournamentEngine.setState(unpublished);
    tournamentEngine.unPublishEvent({ eventId });
    const withdrawn = tournamentEngine.getTournament().tournamentRecord;
    const coldStorage = {
      findTournamentRecord: async () => ({ tournamentRecord: withdrawn }),
    } as unknown as ITournamentStorage;

    const drawData: any = await getDrawData({ tournamentId: TEST_TID, drawId: DRAW_ID }, coldStorage);
    expect(drawData.drawInfo?.drawId).toEqual(DRAW_ID);
    expect(drawData.drawInfo?.drawPublished).toBe(false);
    expect(drawData.structures).toBeUndefined();

    // restore engine state for any later test in this file
    tournamentEngine.setState(record);
  });
});

describe('the shared POLICY_PRIVACY_DEFAULT fixture is never mutated', () => {
  it('survives every public route byte-identical', async () => {
    const before = JSON.stringify(fixtures.policies.POLICY_PRIVACY_DEFAULT);
    for (const [, invoke] of routes) await invoke();
    expect(JSON.stringify(fixtures.policies.POLICY_PRIVACY_DEFAULT)).toEqual(before);
  });

  it('so one route cannot widen another: the schedule route is unchanged by an event-data call', async () => {
    // The exact historical defect. `getCompetitionScheduleMatchUps` reads the shared fixture and never
    // opted into any widening; a single prior `getEventData` used to loosen it for the whole process.
    const cold = await getCompetitionScheduleMatchUps({ tournamentId: TEST_TID, hydrateParticipants: false }, storage);
    await getEventData({ tournamentId: TEST_TID, eventId }, storage);
    await getDrawData({ tournamentId: TEST_TID, drawId: DRAW_ID }, storage);
    await getStructureData({ tournamentId: TEST_TID, drawId: DRAW_ID, structureId }, storage);
    const warm = await getCompetitionScheduleMatchUps({ tournamentId: TEST_TID, hydrateParticipants: false }, storage);

    // control: the schedule route really did return participants in both runs
    expect(Object.keys(cold.mappedParticipants ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(warm.mappedParticipants ?? {}).length).toEqual(
      Object.keys(cold.mappedParticipants ?? {}).length,
    );
    expect(findLeaks(warm, forbidden).leaks).toEqual([]);
  });
});
