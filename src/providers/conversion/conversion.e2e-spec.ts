import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { TEST_EMAIL, TEST_PASSWORD } from '../../common/constants/test';

describe('ConversionService', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  it('/GET /conversion', async () => {
    return await request(app.getHttpServer()).get('/conversion').expect(200);
  });

  it('/POST executionQueue no auth', async () => {
    return await request(app.getHttpServer()).post('/conversion/convert').send({}).expect(401);
  });

  it('should get JWT then successful executionQueue', async () => {
    const loginReq = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);

    const token = loginReq.body.token;

    const result = await request(app.getHttpServer())
      .post('/conversion/convert')
      .set('Authorization', 'Bearer ' + token)
      .send({ tournament: { tuid: 'tid' } })
      .expect(200);
    expect(result.body.tournamentRecord.tournamentId).toEqual('tid');
  });

  afterAll(async () => {
    await app.close();
  });
});
