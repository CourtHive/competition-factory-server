import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { it } from '@jest/globals';
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

  it('/GET /', async () => {
    const result = await request(app.getHttpServer()).get('/').expect(200);
    expect(result.body).toEqual({ message: 'Factory server' });
  });

  afterAll(async () => {
    await app.close();
  });
});
