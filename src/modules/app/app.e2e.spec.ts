import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

describe('Static Files', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  it('/GET / redirects to courthive.com', async () => {
    const result = await request(app.getHttpServer()).get('/').expect(301);
    expect(result.headers.location).toBe('https://courthive.com');
  });

  afterAll(async () => {
    await app.close();
  });
});
