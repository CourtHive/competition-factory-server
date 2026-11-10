import { ensureUser, signSessionToken, superAdminToken } from 'src/tests/helpers/sessionToken';
import { PG_POOL } from 'src/storage/postgres/postgres.config';
import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';

describe.skipIf(process.env.STORAGE_PROVIDER !== 'postgres')('team provider defaults over HTTP', () => {
  const providerId = `test-team-display-http-${randomUUID()}`;
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let directorToken: string;
  const directorEmail = `${providerId}@example.test`;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    pool = app.get(PG_POOL);
    token = await superAdminToken(app);
    await ensureUser(app, directorEmail, ['client']);
    directorToken = await signSessionToken(app, { email: directorEmail });
    await pool.query(
      'INSERT INTO providers (provider_id, organisation_abbreviation, organisation_name, data) VALUES ($1, $1, $2, $3)',
      [providerId, 'HTTP College', JSON.stringify({ privateKey: 'hidden' })],
    );
  });
  afterAll(async () => {
    await pool?.query('DELETE FROM providers WHERE provider_id = $1', [providerId]);
    await pool?.query('DELETE FROM users WHERE email = $1', [directorEmail]);
    await app?.close();
  });
  it('authenticates, writes named roles, rejects a dangling role and exports only safe TEAM details', async () => {
    const path = `/provider/${providerId}/team-display`;
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .put(path)
      .set('Authorization', `Bearer ${directorToken}`)
      .send({ teamColors: {} })
      .expect(403);
    const teamColors = {
      palette: [{ colorId: 'navy', value: '#13294b' }],
      display: { roles: { 'team.surface': 'navy' } },
    };
    await request(app.getHttpServer())
      .put(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ teamColors })
      .expect(200);
    await request(app.getHttpServer())
      .put(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ teamColors: { ...teamColors, display: { roles: { 'team.surface': 'missing' } } } })
      .expect(400);
    const result = await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`).expect(200);
    expect(result.body.participant.teamColors.palette[0].value).toBe('#13294B');
    expect(result.body.participant.teamColors.display.roles).toEqual(teamColors.display.roles);
    expect(JSON.stringify(result.body)).not.toContain('privateKey');
    const directory = await request(app.getHttpServer())
      .get('/provider/team-displays?q=HTTP%20College')
      .set('Authorization', `Bearer ${directorToken}`)
      .expect(200);
    expect(directory.body.teams.some((team: any) => team.participantId === providerId)).toBe(true);
    expect(JSON.stringify(directory.body)).not.toContain('teamColors');
  });
});
