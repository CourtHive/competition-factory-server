import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mocksEngine } from 'tods-competition-factory';
import request from 'supertest';

import { TEST_EMAIL, TEST_PASSWORD, testTournamentId } from 'src/common/constants/test';
import { saveAndCommit } from 'src/tests/helpers/saveAndCommit';
import { seededRng } from 'src/tests/helpers/seededRng';

/**
 * The public tournament-info gate through the REAL app: guards, AuthMiddleware and storage.
 *
 * The unit spec proves the controller's decision. This proves the premise that decision rests on —
 * that `@Public()` routes still receive the caller's `userContext` from AuthMiddleware when a token is
 * sent — which no mock can establish. If the middleware stopped hydrating public routes, the entitled
 * cases below would start returning MISSING_TOURNAMENT_RECORD.
 */

const tournamentId = testTournamentId(__filename);
const NOT_FOUND = 'Tournament not found';

describe('public tournament info gate (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);
    token = login.body.token;

    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      tournamentAttributes: { tournamentId },
      drawProfiles: [{ drawSize: 4 }],
      random: seededRng(4242),
    });
    await saveAndCommit(app.getHttpServer(), token, tournamentRecord);
  });

  afterAll(async () => {
    await app.close();
  });

  const anonymousPost = (body: any) => request(app.getHttpServer()).post('/factory/tournamentinfo').send(body);
  const tokenPost = (body: any) =>
    request(app.getHttpServer()).post('/factory/tournamentinfo').set('Authorization', `Bearer ${token}`).send(body);

  it('withholds the unpublished tournament from an anonymous caller, on both routes', async () => {
    const post = await anonymousPost({ tournamentId }).expect(201);
    expect(post.body.tournamentInfo).toBeUndefined();

    // indistinguishable from a tournament that does not exist, so existence is not confirmed
    const absent = await anonymousPost({ tournamentId: `${tournamentId}-does-not-exist` }).expect(201);
    expect(absent.body.error).toEqual(NOT_FOUND);
    expect(post.body).toEqual(absent.body);

    const get = await request(app.getHttpServer()).get(`/factory/tournamentinfo/${tournamentId}`).expect(200);
    expect(get.body.tournamentInfo).toBeUndefined();
  });

  it('serves it to a caller whose token grants access — AuthMiddleware reaches the public route', async () => {
    const result = await tokenPost({ tournamentId }).expect(201);
    expect(result.body.tournamentInfo?.tournamentId).toEqual(tournamentId);
    // the entitled caller chose no filter, so every event comes back
    expect(result.body.tournamentInfo.eventInfo.length).toBeGreaterThan(0);
  });

  it('serves it to anyone once published, filtered to what is published', async () => {
    const publish = await request(app.getHttpServer())
      .post('/factory')
      .set('Authorization', `Bearer ${token}`)
      .send({ tournamentIds: [tournamentId], methods: [{ method: 'publishOrderOfPlay', params: {} }] })
      .expect(200);
    expect(publish.body.success).toEqual(true);

    const result = await anonymousPost({ tournamentId, usePublishState: false }).expect(201);
    expect(result.body.tournamentInfo?.tournamentId).toEqual(tournamentId);
    // the order of play is published, no event is — and the anonymous caller cannot opt out of the filter
    expect(result.body.tournamentInfo.eventInfo).toEqual([]);
  });
});
