import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { it } from '@jest/globals';
import request from 'supertest';

import { TEST_EMAIL, TEST_PASSWORD } from 'src/common/constants/test';

describe('ProvidersService', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  test('/POST calendar no auth', async () => {
    const result = await request(app.getHttpServer())
      .post('/provider/calendar')
      .send({ providerAbbr: 'TMX' })
      .expect(200);
    if (result.body.success) expect(result.body.calendar).toBeDefined();
  });

  test('/POST calendar no provider', async () => {
    const result = await request(app.getHttpServer())
      .post('/provider/calendar')
      .send({ providerAbbr: 'foo' })
      .expect(200);
    expect(result.body.success).toEqual(false);
  });

  test('/POST getProviders no auth', async () => {
    await request(app.getHttpServer()).post('/provider/allproviders').expect(401);
  });

  test('/POST provider detail no auth', async () => {
    await request(app.getHttpServer()).post('/provider/detail').expect(401);
  });

  it('should get JWT then successful executionQueue', async () => {
    const loginReq = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);

    const token = loginReq.body.token;

    const result = await request(app.getHttpServer())
      .post('/provider/allproviders')
      .set('Authorization', 'Bearer ' + token)
      .expect(200);

    if (result.body.success) {
      expect(result.body.providers.length).toBeGreaterThan(0);
    }
  });

  afterAll(async () => {
    await app.close();
  });
});
