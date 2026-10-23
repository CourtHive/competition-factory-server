/**
 * Public routes carry each individual's TEAM (school), limited to `PUBLIC_TEAM_TEMPLATE`.
 *
 * courthive-components `renderTeam` reads `individualParticipant.teams[0].participantName` for a draw's
 * "participant detail: TEAM" setting. TMX and courthive-public share that code, so a public route that
 * drops `teams` renders a blank line where the school belongs. The routes did exactly that once the shared
 * fixture stopped being widened in place: the default policy has no `teams` key, so the factory's
 * attribute filter removed it. Measured on a live ITA regional: 0 of 138 INDIVIDUALs carried `teams`.
 */
import { mocksEngine, tournamentEngine, factoryConstants, fixtures } from 'tods-competition-factory';

import { getCompetitionScheduleMatchUps } from './getCompetitionScheduleMatchUps';
import { PUBLIC_TEAM_TEMPLATE } from './participantPrivacyPolicy';
import { getStructureData } from './getStructureData';
import { getParticipants } from './getParticipants';
import { getEventData } from './getEventData';
import { getDrawData } from './getDrawData';

import type { ITournamentStorage } from 'src/storage/interfaces';

const { DOUBLES } = factoryConstants.eventConstants;
const { INDIVIDUAL, PAIR, TEAM } = factoryConstants.participantConstants;

const TEST_TID = 'test-public-teams';
const SINGLES_DRAW_ID = 'public-teams-singles';
const DOUBLES_DRAW_ID = 'public-teams-doubles';
const START_DATE = '2024-01-01';
const VENUE_ID = 'public-teams-venue';
const SCHOOLS = ['Duke', 'Wake Forest'];
const ALLOWED_TEAM_KEYS = Object.keys(PUBLIC_TEAM_TEMPLATE);

function buildRecord() {
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    tournamentAttributes: { tournamentId: TEST_TID },
    eventProfiles: [
      { eventName: 'Singles', drawProfiles: [{ drawSize: 8, drawId: SINGLES_DRAW_ID }] },
      { eventName: 'Doubles', eventType: DOUBLES, drawProfiles: [{ drawSize: 4, drawId: DOUBLES_DRAW_ID }] },
    ],
    venueProfiles: [{ venueId: VENUE_ID, venueName: 'Courts', startTime: '08:00', endTime: '20:00', courtsCount: 4 }],
    schedulingProfile: [
      {
        scheduleDate: START_DATE,
        venues: [
          {
            venueId: VENUE_ID,
            rounds: [
              { drawId: SINGLES_DRAW_ID, roundNumber: 1 },
              { drawId: DOUBLES_DRAW_ID, roundNumber: 1 },
            ],
          },
        ],
      },
    ],
    endDate: '2024-01-03',
    startDate: START_DATE,
    nonRandom: 1,
  });

  // Set on the generated record BEFORE setState: `getTournament()` returns a copy, so a later write would
  // reach nothing and "person.sex stays closed" would hold vacuously.
  for (const participant of tournamentRecord.participants ?? []) {
    if (participant.person) participant.person.sex = 'MALE';
  }
  tournamentEngine.setState(tournamentRecord);

  // Every individual belongs to one of two schools. The TEAM carries data that must never reach a public
  // reader through an individual's `teams` entry: contacts, online resources and its member list.
  const individuals = (
    tournamentEngine.getParticipants({ participantFilters: { participantTypes: [INDIVIDUAL] } }).participants ?? []
  ).map((participant: any) => participant.participantId);
  const half = Math.ceil(individuals.length / 2);
  const teams: any[] = SCHOOLS.map((participantName, index) => ({
    participantId: `team-${index}`,
    participantType: TEAM,
    participantRole: 'COMPETITOR',
    participantName,
    participantOtherName: participantName.toUpperCase(),
    individualParticipantIds: individuals.slice(index * half, (index + 1) * half),
    contacts: [{ emailAddress: `coach@school-${index}.edu` }],
    onlineResources: [{ identifier: `https://school-${index}.edu`, resourceType: 'URL' }],
    participantRoleResponsibilities: [`Head coach of school-${index}`],
  }));
  const added = tournamentEngine.addParticipants({ participants: teams });
  if (added.error) throw new Error(`addParticipants: ${JSON.stringify(added.error)}`);

  tournamentEngine.scheduleProfileRounds({ scheduleDates: [START_DATE] });
  tournamentEngine.publishOrderOfPlay();
  tournamentEngine.publishParticipants();
  const events = tournamentEngine.getEvents().events ?? [];
  for (const { eventId } of events) tournamentEngine.publishEvent({ eventId });

  const record = tournamentEngine.getTournament().tournamentRecord;
  const eventIdFor = (drawId: string) =>
    record.events.find((event: any) => event.drawDefinitions?.some((d: any) => d.drawId === drawId)).eventId;
  return { record, singlesEventId: eventIdFor(SINGLES_DRAW_ID), doublesEventId: eventIdFor(DOUBLES_DRAW_ID) };
}

const { record, singlesEventId, doublesEventId } = buildRecord();
const storage = {
  findTournamentRecord: async ({ tournamentId }: any) =>
    tournamentId === TEST_TID ? { tournamentRecord: record } : { error: 'NOT_FOUND' },
  fetchTournamentRecords: async ({ tournamentId }: any) =>
    tournamentId === TEST_TID ? { tournamentRecords: { [TEST_TID]: record } } : { error: 'NOT_FOUND' },
} as unknown as ITournamentStorage;

const schoolOf = (participantId: string) =>
  record.participants.find(
    (participant: any) =>
      participant.participantType === TEAM && participant.individualParticipantIds.includes(participantId),
  )?.participantName;

/** Every `teams` array anywhere in a response, with the path it was found at. */
function teamsArrays(node: any) {
  const found: { path: string; teams: any[] }[] = [];
  const seen = new WeakSet();
  const visit = (value: any, path: string) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) return value.forEach((member, index) => visit(member, `${path}[${index}]`));
    for (const [key, child] of Object.entries(value)) {
      if (key === 'teams' && Array.isArray(child)) found.push({ path: `${path}.teams`, teams: child });
      visit(child, `${path}.${key}`);
    }
  };
  visit(node, '$');
  return found;
}

/** Every object anywhere in a response that is a participant of the given type. */
function participantsOfType(node: any, participantType: string) {
  const found: any[] = [];
  const seen = new WeakSet();
  const visit = (value: any) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) return value.forEach(visit);
    if (value.participantType === participantType && value.participantId) found.push(value);
    Object.values(value).forEach(visit);
  };
  visit(node);
  return found;
}
const individualsIn = (node: any) => participantsOfType(node, INDIVIDUAL);
const pairsIn = (node: any) =>
  participantsOfType(node, PAIR).filter((pair: any) => pair.individualParticipants?.length);

function expectOnlyAllowedTeamKeys(response: any) {
  const arrays = teamsArrays(response);
  expect(arrays.length).toBeGreaterThan(0);
  for (const { path, teams } of arrays) {
    for (const team of teams) {
      expect({ path, keys: Object.keys(team).filter((key) => !ALLOWED_TEAM_KEYS.includes(key)) }).toEqual({
        path,
        keys: [],
      });
    }
  }
}

describe('the fixture can prove anything', () => {
  it('every individual is on a school, and the schools hold data that must stay private', () => {
    const individuals = record.participants.filter((participant: any) => participant.participantType === INDIVIDUAL);
    expect(individuals.length).toBeGreaterThan(0);
    for (const individual of individuals) expect(SCHOOLS).toContain(schoolOf(individual.participantId));
    const team = record.participants.find((participant: any) => participant.participantType === TEAM);
    expect(team.contacts?.length).toBeGreaterThan(0);
    expect(team.onlineResources?.length).toBeGreaterThan(0);
    expect(team.participantRoleResponsibilities?.length).toBeGreaterThan(0);
    // and every person holds a `sex` the default policy must keep closed
    for (const individual of individuals) expect(individual.person?.sex).toBe('MALE');
  });
});

describe('getEventData carries each individual school', () => {
  it.each([
    ['hydrateParticipants: false (what courthive-public sends)', false],
    ['hydrateParticipants: true', true],
  ])('singles, %s: every top-level INDIVIDUAL has teams[0].participantName', async (_label, hydrateParticipants) => {
    const response: any = await getEventData(
      { tournamentId: TEST_TID, eventId: singlesEventId, hydrateParticipants },
      storage,
    );
    expect(response.error).toBeUndefined();
    const individuals = (response.participants ?? []).filter((p: any) => p.participantType === INDIVIDUAL);
    expect(individuals.length).toBeGreaterThan(0);
    for (const individual of individuals) {
      expect(individual.teams?.[0]?.participantName).toEqual(schoolOf(individual.participantId));
    }
  });

  it('singles, hydrateParticipants: true: bracket sides carry the school', async () => {
    const response: any = await getEventData(
      { tournamentId: TEST_TID, eventId: singlesEventId, hydrateParticipants: true },
      storage,
    );
    const sideParticipants = individualsIn(response.eventData?.drawsData ?? []);
    // control: the brackets really do hold hydrated participants
    expect(sideParticipants.length).toBeGreaterThan(0);
    for (const participant of sideParticipants) {
      expect(participant.teams?.[0]?.participantName).toEqual(schoolOf(participant.participantId));
    }
  });

  it('doubles, hydrateParticipants: false: every PAIR member resolves to an INDIVIDUAL with its school', async () => {
    // Unhydrated, a PAIR lists its members by id and the members are top-level INDIVIDUALs.
    const response: any = await getEventData({ tournamentId: TEST_TID, eventId: doublesEventId }, storage);
    expect(response.error).toBeUndefined();
    const byId = new Map((response.participants ?? []).map((p: any) => [p.participantId, p]));
    const pairs = (response.participants ?? []).filter((p: any) => p.participantType === PAIR);
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      expect(pair.individualParticipantIds?.length).toBe(2);
      for (const memberId of pair.individualParticipantIds) {
        const member: any = byId.get(memberId);
        expect(member?.teams?.[0]?.participantName).toEqual(schoolOf(memberId));
      }
    }
  });

  it('doubles, hydrateParticipants: true: bracket-side PAIR members carry the school (the nested block)', async () => {
    // Hydrated sides nest members under `individualParticipants`, which the policy's SECOND block governs.
    // Opening `teams` only on the top-level block passes every singles test and blanks this one.
    const response: any = await getEventData(
      { tournamentId: TEST_TID, eventId: doublesEventId, hydrateParticipants: true },
      storage,
    );
    const members = pairsIn(response.eventData?.drawsData ?? []).flatMap((pair: any) => pair.individualParticipants);
    expect(members.length).toBeGreaterThan(0);
    for (const member of members) {
      expect(member.teams?.[0]?.participantName).toEqual(schoolOf(member.participantId));
    }
  });

  it('team entries hold only the allowed keys, and person.sex stays closed', async () => {
    for (const eventId of [singlesEventId, doublesEventId]) {
      for (const hydrateParticipants of [false, true]) {
        const response: any = await getEventData({ tournamentId: TEST_TID, eventId, hydrateParticipants }, storage);
        expectOnlyAllowedTeamKeys(response);
        const text = JSON.stringify(response);
        expect(text).not.toContain('coach@school-');
        expect(text).not.toContain('https://school-');
        expect(text).not.toContain('Head coach of school-');
        expect(text).not.toContain('"sex"');
      }
    }
  });
});

describe('the draw and structure routes carry the school the same way', () => {
  it.each([
    [
      'getDrawData',
      () => getDrawData({ tournamentId: TEST_TID, drawId: SINGLES_DRAW_ID, hydrateParticipants: true }, storage),
    ],
    [
      'getStructureData',
      () => {
        const structureId = record.events
          .flatMap((event: any) => event.drawDefinitions ?? [])
          .find((drawDefinition: any) => drawDefinition.drawId === SINGLES_DRAW_ID).structures[0].structureId;
        return getStructureData(
          { tournamentId: TEST_TID, drawId: SINGLES_DRAW_ID, structureId, hydrateParticipants: true },
          storage,
        );
      },
    ],
  ])('%s', async (_name, invoke: () => Promise<any>) => {
    const response: any = await invoke();
    expect(response.error).toBeUndefined();
    const individuals = individualsIn(response);
    expect(individuals.length).toBeGreaterThan(0);
    for (const individual of individuals) {
      expect(individual.teams?.[0]?.participantName).toEqual(schoolOf(individual.participantId));
    }
    expectOnlyAllowedTeamKeys(response);
    expect(JSON.stringify(response)).not.toContain('"sex"');
  });
});

describe('the schedule and participants routes carry the school the same way', () => {
  it.each([
    // courthive-public sends `hydrateParticipants: false`, which populates `mappedParticipants`.
    [
      'getCompetitionScheduleMatchUps',
      () => getCompetitionScheduleMatchUps({ tournamentId: TEST_TID, hydrateParticipants: false }, storage),
    ],
    ['getParticipants', () => getParticipants({ tournamentId: TEST_TID }, storage)],
  ])('%s', async (_name, invoke: () => Promise<any>) => {
    const response: any = await invoke();
    expect(response.error).toBeUndefined();
    const individuals = individualsIn(response);
    expect(individuals.length).toBeGreaterThan(0);
    for (const individual of individuals) {
      expect(individual.teams?.[0]?.participantName).toEqual(schoolOf(individual.participantId));
    }
    expectOnlyAllowedTeamKeys(response);
    expect(JSON.stringify(response)).not.toContain('"sex"');
  });
});

describe('opening teams opens nothing else', () => {
  it('the shared fixture is byte-identical after every route', async () => {
    const before = JSON.stringify(fixtures.policies.POLICY_PRIVACY_DEFAULT);
    await getEventData({ tournamentId: TEST_TID, eventId: singlesEventId, hydrateParticipants: true }, storage);
    await getDrawData({ tournamentId: TEST_TID, drawId: DOUBLES_DRAW_ID, hydrateParticipants: true }, storage);
    await getCompetitionScheduleMatchUps({ tournamentId: TEST_TID, hydrateParticipants: false }, storage);
    await getParticipants({ tournamentId: TEST_TID }, storage);
    expect(JSON.stringify(fixtures.policies.POLICY_PRIVACY_DEFAULT)).toEqual(before);
    expect((fixtures.policies.POLICY_PRIVACY_DEFAULT as any).participant.participant.teams).toBeUndefined();
  });
});
