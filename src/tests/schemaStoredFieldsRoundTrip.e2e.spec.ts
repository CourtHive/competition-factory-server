import { mocksEngine, tournamentEngine, fixtures, factoryConstants } from 'tods-competition-factory';
import { TEST_EMAIL, TEST_PASSWORD, testTournamentId } from '../common/constants/test';
import tournamentSchema from 'tods-competition-factory/schema/tournament.schema.json';
import asyncGlobalState from '../modules/factory/engines/asyncGlobalState';
import { saveAndCommit } from './helpers/saveAndCommit';
import { AppModule } from '../modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import addFormats from 'ajv-formats';
import { json } from 'body-parser';
import request from 'supertest';
import Ajv from 'ajv';

/**
 * A RECORD THE SERVER STORED STILL VALIDATES AGAINST THE PUBLISHED SCHEMA.
 *
 * The published `tournament.schema.json` lacked fields the engine stores (factory #5635): a record failed
 * strict validation after its first double exit, because the engine writes `sideExitProvenance` and
 * `byeFromPropagation`. This spec sends one public method per such field the way TMX sends it (POST
 * /factory, an executionQueue payload), fetches the stored record back and validates it against the
 * schema the factory PUBLISHES. It is the check a consumer validating stored records would make, and it
 * also shows the server's save and fetch carry every field.
 *
 * Mirrors `storedFieldsScenario` in factory `src/tests/global/schemaCoversStoredTypes.test.ts`.
 */

const { POLICY_TYPE_SEEDING } = factoryConstants.policyConstants;

const DATE = '2026-06-15';
const REPORTED_TIE_FORMAT = {
  tieFormatName: 'REPORTED_SINGLES_3',
  scoreSource: 'REPORTED',
  winCriteria: { valueGoal: 2 },
  collectionDefinitions: [
    {
      collectionName: 'Singles',
      matchUpFormat: 'SET3-S:6/TB7',
      collectionId: 'singles',
      matchUpType: 'SINGLES',
      collectionOrder: 1,
      matchUpValue: 1,
      matchUpCount: 3,
    },
  ],
};

/** each field the payload writes, as the key the stored record carries */
const SCENARIO_FIELDS = [
  'sideExitProvenance',
  'byeFromPropagation',
  'sideStatusCodes',
  'matchUpStatusCode',
  'checkIns',
  'presence',
  'participantOtherIds',
  'drawOtherIds',
  'seedingBasis',
  'contactParticipantIds',
  'registrations',
  'bookingId',
  'capacity',
  'scoreSource',
];

function scenario(tournamentId: string) {
  const itfSeeding = fixtures.policies.POLICY_SEEDING_ITF[POLICY_TYPE_SEEDING];
  const seedingPolicy = { [POLICY_TYPE_SEEDING]: { ...itfSeeding, additionalSeeds: { maxCount: 1 } } };
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    venueProfiles: [{ venueId: 'venue', courtsCount: 2 }],
    participantsProfile: { participantsCount: 40 },
    tournamentAttributes: { tournamentId },
    drawProfiles: [
      { drawId: 'compass', drawType: 'COMPASS', drawSize: 16 },
      { drawId: 'seeded', drawSize: 32, seedsCount: 8, policyDefinitions: seedingPolicy },
      { drawId: 'doubles', drawSize: 4, eventType: 'DOUBLES' },
      { drawId: 'team', drawSize: 4, eventType: 'TEAM', tieFormat: REPORTED_TIE_FORMAT },
    ],
    startDate: DATE,
    endDate: DATE,
    nonRandom: 1,
  });

  // read the ids the payload needs from a local copy, as a client would
  tournamentEngine.setState(tournamentRecord, true);
  const matchUps: any[] = tournamentEngine.allTournamentMatchUps({ inContext: true }).matchUps ?? [];
  const east = (roundPosition: number): any =>
    matchUps.find(
      (matchUp: any) =>
        matchUp.drawId === 'compass' &&
        matchUp.structureName === 'East' &&
        matchUp.roundNumber === 1 &&
        matchUp.roundPosition === roundPosition,
    );
  const { event, drawDefinition }: any = tournamentEngine.getEvent({ drawId: 'seeded' });
  const seeded = drawDefinition.structures[0];
  const unseeded = seeded.positionAssignments
    .map((assignment: any) => assignment.participantId)
    .filter(Boolean)
    .find((participantId: string) => !seeded.seedAssignments.some((seed: any) => seed.participantId === participantId));
  const pairs = tournamentEngine.getParticipants({ participantFilters: { participantTypes: ['PAIR'] } }).participants;
  const pair: any = pairs?.[0];
  const individual = east(4).sides[0].participantId;
  const courtId = tournamentRecord.venues[0].courts[0].courtId;
  const booking = {
    bookingId: 'booking-1',
    bookingType: 'PRACTICE',
    startTime: '14:00',
    endTime: '16:00',
    capacity: 4,
  };

  const methods = [
    {
      method: 'setMatchUpStatus',
      params: {
        outcome: { matchUpStatus: 'DOUBLE_WALKOVER' },
        matchUpId: east(1).matchUpId,
        propagateExitStatus: true,
        drawId: 'compass',
      },
    },
    {
      method: 'setMatchUpStatus',
      params: {
        outcome: { matchUpStatus: 'WALKOVER', winningSide: 1, matchUpStatusCodes: ['', 'WO'] },
        matchUpId: east(2).matchUpId,
        drawId: 'compass',
      },
    },
    {
      method: 'setMatchUpStatus',
      params: {
        outcome: { matchUpStatus: 'ABANDONED', matchUpStatusCodes: ['RAIN'] },
        matchUpId: east(3).matchUpId,
        drawId: 'compass',
      },
    },
    {
      method: 'checkInParticipant',
      params: { matchUpId: east(4).matchUpId, participantId: individual, drawId: 'compass' },
    },
    { method: 'modifyParticipantsSignInStatus', params: { participantIds: [individual], signInState: 'SIGNED_IN' } },
    {
      method: 'addParticipantOtherId',
      params: { participantId: individual, organisationId: 'org', otherParticipantId: 'other-participant' },
    },
    { method: 'addDrawOtherId', params: { drawId: 'compass', organisationId: 'org', otherDrawId: 'other-draw' } },
    {
      method: 'addAdditionalSeed',
      params: {
        structureId: seeded.structureId,
        seedingBasis: 'PROTECTED_RANKING',
        participantId: unseeded,
        eventId: event.eventId,
        drawId: 'seeded',
      },
    },
    {
      method: 'modifyParticipant',
      params: {
        participant: { participantId: pair.participantId, contactParticipantIds: [pair.individualParticipantIds[0]] },
      },
    },
    {
      method: 'modifyCourtAvailability',
      params: {
        courtId,
        dateAvailability: [{ date: DATE, startTime: '08:00', endTime: '20:00', bookings: [booking] }],
      },
    },
    {
      method: 'addPracticeRegistration',
      params: {
        courtId,
        date: DATE,
        bookingId: 'booking-1',
        participantId: individual,
        startTime: '14:00',
        endTime: '14:30',
      },
    },
  ];
  return { tournamentRecord, methods };
}

describe('a stored record validates against the published schema', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // main.ts raises the body limit for whole-record saves; the testing module does not run main.ts
    app.use(json({ limit: '8mb' }));
    await app.init();
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);
    token = login.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('carries every stored field through executionQueue, save and fetch, and validates', async () => {
    const tournamentId = testTournamentId(__filename);
    // the scenario reads ids from a local engine; scope its state as the server scopes a request's
    const { tournamentRecord, methods } = asyncGlobalState.runWithInstanceState(() => scenario(tournamentId));
    await saveAndCommit(app.getHttpServer(), token, tournamentRecord);

    // one call per method, as TMX sends them, so a refusal names its method
    for (const method of methods) {
      const result = await request(app.getHttpServer())
        .post('/factory')
        .set('Authorization', 'Bearer ' + token)
        .send({ methods: [method], tournamentIds: [tournamentId] })
        .expect(200);
      expect(result.body.success, `${method.method}: ${JSON.stringify(result.body.error)}`).toEqual(true);
    }

    const fetched = await request(app.getHttpServer())
      .post('/factory/fetch')
      .set('Authorization', 'Bearer ' + token)
      .send({ tournamentId })
      .expect(200);
    const stored = fetched.body.tournamentRecords?.[tournamentId];
    expect(stored).toBeDefined();

    // CONTROL: the server stored each field, so the validation below is about it
    const serialized = JSON.stringify(stored);
    expect(SCENARIO_FIELDS.filter((field) => !serialized.includes(`"${field}"`))).toEqual([]);

    const ajv = new Ajv({ allowUnionTypes: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(tournamentSchema);
    const valid = validate(stored);
    expect(valid, ajv.errorsText(validate.errors)).toEqual(true);
  });
});
