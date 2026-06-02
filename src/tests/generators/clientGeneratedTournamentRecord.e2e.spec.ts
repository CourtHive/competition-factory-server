import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../modules/app/app.module';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { mocksEngine, factoryConstants } from 'tods-competition-factory';
import { saveAndCommit } from '../helpers/saveAndCommit';
import { seededRng } from '../helpers/seededRng';
import { TEST_EMAIL, TEST_PASSWORD, testTournamentId } from '../../common/constants/test';

const { SINGLES } = factoryConstants.eventConstants;

describe('ClientGeneratedTournamentRecord', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const loginReq = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);

    token = loginReq.body.token;
  });

  it('should have a token', async () => {
    expect(token).toBeDefined();
  });

  it('can remove, create, save and fetch a tournamentRecord', async () => {
    const tournamentId = testTournamentId(__filename);

    // Cleanup step — fine if the tournament doesn't exist yet (clean DB)
    // or if a prior run already left one behind. Accept either status.
    const removed = await request(app.getHttpServer())
      .post('/factory/remove')
      .set('Authorization', 'Bearer ' + token)
      .send({ tournamentId });
    expect([200, 404]).toContain(removed.status);
    if (removed.status === 200) expect(removed.body.success).toEqual(true);

    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      eventProfiles: [{ eventId: 'e1', eventType: SINGLES }],
      tournamentAttributes: { tournamentId },
      random: seededRng(2002),
    });

    expect(tournamentRecord.events.length).toEqual(1);

    await saveAndCommit(app.getHttpServer(), token, tournamentRecord);

    const fetched = await request(app.getHttpServer())
      .post('/factory/fetch')
      .set('Authorization', 'Bearer ' + token)
      .send({ tournamentId })
      .expect(200);
    expect(fetched.body.success).toEqual(true);
    expect(fetched.body.fetched).toEqual(1);
  });

  afterAll(async () => {
    await app.close();
  });
});
