import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mocksEngine } from 'tods-competition-factory';
import request from 'supertest';

import { saveAndCommit } from 'src/tests/helpers/saveAndCommit';
import { seededRng } from 'src/tests/helpers/seededRng';
import { TEST_EMAIL, TEST_PASSWORD, testTournamentId } from 'src/common/constants/test';

const tournamentId = testTournamentId(__filename);

describe('FactoryService', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  it('/GET /factory', async () => {
    return await request(app.getHttpServer()).get('/factory').expect(200);
  });

  it('/GET /factory/version', async () => {
    return await request(app.getHttpServer()).get('/factory/version').expect(200);
  });

  it('/POST executionQueue no auth', async () => {
    return await request(app.getHttpServer())
      .post('/factory')
      .send({ tournamentIds: [tournamentId] })
      .expect(401);
  });

  it('/POST fetchTournamentRecords no auth', async () => {
    return await request(app.getHttpServer())
      .post('/factory/fetch')
      .send({ tournamentIds: [tournamentId] })
      .expect(401);
  });

  it('should get JWT then successful executionQueue', async () => {
    const loginReq = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);

    const token = loginReq.body.token;

    // ENSURE: tournamentRecord exists (use save to await persistence).
    // Seeded RNG keeps the generated tournament_name stable across runs.
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      tournamentAttributes: { tournamentId },
      random: seededRng(1001),
    });
    await saveAndCommit(app.getHttpServer(), token, tournamentRecord);

    const result = await request(app.getHttpServer())
      .post('/factory')
      .set('Authorization', 'Bearer ' + token)
      .send({
        methods: [
          {
            params: {
              startDate: '2024-01-01',
              endDate: '2024-01-02',
              tournamentId,
            },
            method: 'setTournamentDates',
          },
        ],
        tournamentId,
      })
      .expect(200);
    expect(result.body.success).toEqual(true);

    return await request(app.getHttpServer())
      .post('/factory/query')
      .set('Authorization', 'Bearer ' + token)
      .send({
        params: { tournamentId },
        method: 'getTournamentInfo',
        tournamentId,
      })
      .expect(200);
  });

  it('/POST /factory/save rejects a malformed tournamentRecord with 400 + validationErrors', async () => {
    const loginReq = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);
    const token = loginReq.body.token;

    // startDate in the wrong format — L1 inside L2 will flag it
    const malformed = {
      tournamentId: `${tournamentId}-malformed`,
      tournamentName: 'Bad Dates',
      startDate: '06/01/2026',
      endDate: '06/07/2026',
    };

    const result = await request(app.getHttpServer())
      .post('/factory/save')
      .set('Authorization', `Bearer ${token}`)
      .send({ tournamentRecord: malformed })
      .expect(400);

    expect(result.body.tournamentId).toBe(`${tournamentId}-malformed`);
    expect(Array.isArray(result.body.validationErrors)).toBe(true);
    expect(result.body.validationErrors.length).toBeGreaterThan(0);
    expect(result.body.validationErrors.some((e: string) => e.includes('startDate'))).toBe(true);
  });

  afterAll(async () => {
    await app.close();
  });
});
