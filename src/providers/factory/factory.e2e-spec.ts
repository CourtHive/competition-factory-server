import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { TEST, TEST_EMAIL, TEST_PASSWORD } from '../../common/constants/test';

describe('AppService', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  it('/GET /factory', async () => {
    return await request(app.getHttpServer()).get('/factory').expect(200);
  });

  it('/GET /factory/version', async () => {
    return await request(app.getHttpServer())
      .get('/factory/version')
      .expect(200);
  });

  it('/POST executionQueue no auth', async () => {
    return await request(app.getHttpServer())
      .post('/factory')
      .send({ tournamentIds: [TEST] })
      .expect(401);
  });

  it('should get JWT then successful executionQueue', async () => {
    const loginReq = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);

    const token = loginReq.body.token;

    // ENSURE: tournamentRecord exists
    await request(app.getHttpServer())
      .post('/factory/generate')
      .set('Authorization', 'Bearer ' + token)
      .send({ tournamentAttributes: { tournamentId: TEST } })
      .expect(200);

    return await request(app.getHttpServer())
      .post('/factory')
      .set('Authorization', 'Bearer ' + token)
      .send({
        executionQueue: [{ method: 'getTournamentInfo', params: {} }],
        tournamentId: TEST,
      })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });
});
