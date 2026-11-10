import { USER_STORAGE, type IUserStorage } from 'src/storage/interfaces/user-storage.interface';
import { ensureUser, signSessionToken, superAdminToken } from 'src/tests/helpers/sessionToken';
import { PG_POOL } from 'src/storage/postgres/postgres.config';
import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';
import {
  USER_PROVIDER_STORAGE,
  type IUserProviderStorage,
} from 'src/storage/interfaces/user-provider-storage.interface';

// constants
import { PROVIDER_ADMIN } from 'src/common/constants/roles';

describe.skipIf(process.env.STORAGE_PROVIDER !== 'postgres')('team provider defaults over HTTP', () => {
  const providerId = `test-team-display-http-${randomUUID()}`;
  const otherProviderId = `test-team-display-http-other-${randomUUID()}`;
  let app: INestApplication;
  let pool: Pool;
  let token: string;
  let directorToken: string;
  let providerAdminToken: string;
  const directorEmail = `${providerId}@example.test`;
  const providerAdminEmail = `admin-${providerId}@example.test`;
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
    await pool.query(
      'INSERT INTO providers (provider_id, organisation_abbreviation, organisation_name, data) VALUES ($1, $1, $2, $3)',
      [otherProviderId, 'HTTP Other College', JSON.stringify({})],
    );
    // PROVIDER_ADMIN of providerId only; AuthMiddleware loads providerRoles from user_providers by email.
    await ensureUser(app, providerAdminEmail, ['client']);
    const adminUser = await app.get<IUserStorage>(USER_STORAGE).findOne(providerAdminEmail);
    await app
      .get<IUserProviderStorage>(USER_PROVIDER_STORAGE)
      .upsert({ userId: adminUser.userId, providerId, providerRole: PROVIDER_ADMIN });
    providerAdminToken = await signSessionToken(app, { email: providerAdminEmail, providerId });
  });
  afterAll(async () => {
    await pool?.query('DELETE FROM user_providers WHERE provider_id = ANY($1)', [[providerId, otherProviderId]]);
    await pool?.query('DELETE FROM providers WHERE provider_id = ANY($1)', [[providerId, otherProviderId]]);
    await pool?.query('DELETE FROM users WHERE email = ANY($1)', [[directorEmail, providerAdminEmail]]);
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

  it('lets a PROVIDER_ADMIN write their own provider and refuses another provider with 403', async () => {
    const teamColors = {
      palette: [{ colorId: 'gold', value: '#ffc72c' }],
      display: { roles: { 'team.surface': 'gold' } },
    };
    await request(app.getHttpServer())
      .put(`/provider/${providerId}/team-display`)
      .set('Authorization', `Bearer ${providerAdminToken}`)
      .send({ teamColors })
      .expect(200);
    const own = await pool.query("SELECT data->'teamColors' AS team_colors FROM providers WHERE provider_id = $1", [
      providerId,
    ]);
    expect(own.rows[0].team_colors.palette[0].value).toBe('#FFC72C');

    await request(app.getHttpServer())
      .put(`/provider/${otherProviderId}/team-display`)
      .set('Authorization', `Bearer ${providerAdminToken}`)
      .send({ teamColors })
      .expect(403);
    const other = await pool.query("SELECT data ? 'teamColors' AS has_colors FROM providers WHERE provider_id = $1", [
      otherProviderId,
    ]);
    expect(other.rows[0].has_colors).toBe(false);
  });

  it('refuses teamColors on the generic provider modify route, even for a super admin', async () => {
    const before = await pool.query('SELECT data FROM providers WHERE provider_id = $1', [otherProviderId]);
    await request(app.getHttpServer())
      .post('/provider/modify')
      .set('Authorization', `Bearer ${token}`)
      .send({ providerId: otherProviderId, teamColors: { palette: [{ colorId: 'red', value: '#ff0000' }] } })
      .expect(400);
    const after = await pool.query('SELECT data FROM providers WHERE provider_id = $1', [otherProviderId]);
    expect(after.rows[0].data).toEqual(before.rows[0].data);
  });
});
