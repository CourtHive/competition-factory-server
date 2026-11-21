import { TournamentStorageService } from 'src/storage/tournament-storage.service';
import { ensureUser, signSessionToken } from 'src/tests/helpers/sessionToken';
import { PG_POOL } from 'src/storage/postgres/postgres.config';
import { AppModule } from 'src/modules/app/app.module';
import { mocksEngine } from 'tods-competition-factory';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Pool } from 'pg';
import {
  USER_STORAGE,
  USER_PROVIDER_STORAGE,
  PROVIDER_STORAGE,
  type IUserStorage,
  type IUserProviderStorage,
  type IProviderStorage,
} from 'src/storage/interfaces';

const suffix = randomUUID().slice(0, 8);
const providers = [`support-e2e-a-${suffix}`, `support-e2e-b-${suffix}`];
const emails = ['reporter', 'peer', 'outsider', 'admin'].map((name) => `support-${name}-${suffix}@courthive.test`);
let reporterId: string;
const input = () => ({
  expectedReporter: reporterId,
  expectedProvider: providers[0],
  submissionKey: randomUUID(),
  description: 'A refused create',
  evidence: {
    route: 'events',
    online: true,
    version: '8.1.0',
    diagnostics: [],
    validation: {
      count: 0,
      schemaErrorCount: 0,
      inconsistencyCount: 0,
      schemaUnavailable: true,
      integrityUnavailable: true,
      truncated: false,
      codes: [],
    },
  },
});

describe.skipIf(process.env.STORAGE_PROVIDER !== 'postgres')(
  'support HTTP authorization through real auth middleware',
  () => {
    let app: INestApplication;
    let users: IUserStorage;
    let pool: Pool;
    let reporter: string;
    let peer: string;
    let outsider: string;
    let admin: string;
    let tournamentIds: string[];
    beforeAll(async () => {
      vi.stubEnv('SUPPORT_REPORTS_ENABLED', 'false'); // Do not activate network workers in the test application.
      const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = module.createNestApplication();
      await app.init();
      users = app.get(USER_STORAGE);
      pool = app.get(PG_POOL);
      const providerStorage = app.get<IProviderStorage>(PROVIDER_STORAGE);
      const associations = app.get<IUserProviderStorage>(USER_PROVIDER_STORAGE);
      for (const id of providers)
        await providerStorage.setProvider(id, {
          organisationId: id,
          organisationName: 'E2E Support',
          organisationAbbreviation: `E2ES${id.slice(-1)}${suffix}`,
        });
      for (const email of emails)
        await ensureUser(app, email, email.includes('admin') ? ['superadmin', 'client'] : ['client']);
      for (const email of emails.slice(0, 2)) {
        const user = await users.findOne(email);
        for (const id of providers)
          await associations.upsert({ userId: user.userId, providerId: id, providerRole: 'PROVIDER_ADMIN' });
      }
      reporterId = (await users.findOne(emails[0])).userId;
      reporter = await signSessionToken(app, { email: emails[0], providerId: providers[0] });
      peer = await signSessionToken(app, { email: emails[1], providerId: providers[0] });
      outsider = await signSessionToken(app, { email: emails[2], providerId: providers[0] });
      admin = await signSessionToken(app, { email: emails[3] });
      tournamentIds = [];
      for (const id of providers) {
        const { tournamentRecord } = mocksEngine.generateTournamentRecord({
          nonRandom: 1,
          tournamentAttributes: {
            tournamentId: `support-http-${id}`,
            parentOrganisation: {
              organisationId: id,
              organisationAbbreviation: 'E2ES',
              organisationName: 'E2E Support',
            },
            tournamentName: 'E2E Support',
          },
        });
        await app.get(TournamentStorageService).saveTournamentRecords({ tournamentRecord, projectionMode: 'snapshot' });
        tournamentIds.push(tournamentRecord.tournamentId);
      }
      vi.stubEnv('SUPPORT_REPORTS_ENABLED', 'true');
    });
    afterAll(async () => {
      if (app) {
        const ids = await Promise.all(emails.map(async (email) => (await users.findOne(email))?.userId));
        await pool.query('DELETE FROM support_cases WHERE reporter_id=ANY($1::text[])', [ids.filter(Boolean)]);
        await app.get(TournamentStorageService).removeTournamentRecords({ tournamentIds });
        for (const email of emails) await users.remove(email);
        for (const id of providers) await app.get<IProviderStorage>(PROVIDER_STORAGE).removeProvider(id);
        await app.close();
      }
      vi.unstubAllEnvs();
    });

    it('rejects unauthenticated, unassociated and cross-provider reports without creating cases', async () => {
      const http = app.getHttpServer();
      await request(http).post('/support/reports').send(input()).expect(401);
      await request(http).post('/support/reports').auth(outsider, { type: 'bearer' }).send(input()).expect(403);
      await request(http)
        .post('/support/reports')
        .auth(reporter, { type: 'bearer' })
        .send({ ...input(), tournamentId: tournamentIds[1] })
        .expect(403);
      expect(
        (await pool.query('SELECT count(*) FROM support_cases WHERE provider_id=ANY($1)', [providers])).rows[0].count,
      ).toBe('0');
    });

    it('returns only an own receipt and reserves descriptions/inbox/resolution for super-admins', async () => {
      const http = app.getHttpServer();
      const created = await request(http)
        .post('/support/reports')
        .auth(reporter, { type: 'bearer' })
        .send({ ...input(), tournamentId: tournamentIds[0] })
        .expect(201);
      await request(http).post('/support/reports').auth(peer, { type: 'bearer' }).send(input()).expect(403);
      await request(http)
        .post('/support/reports')
        .auth(reporter, { type: 'bearer' })
        .send({ ...input(), expectedProvider: providers[1] })
        .expect(403);
      const ref = created.body.reference;
      expect(created.body).toMatchObject({ accepted: true, snapshot: 'not_attached', contact: 'pending' });
      expect(created.body.description).toBeUndefined();
      await request(http).get(`/support/reports/${ref}`).auth(peer, { type: 'bearer' }).expect(404);
      await request(http).get('/admin/support/reports').auth(reporter, { type: 'bearer' }).expect(403);
      await request(http).get(`/admin/support/reports/${ref}`).auth(reporter, { type: 'bearer' }).expect(403);
      await request(http)
        .post(`/admin/support/reports/${ref}/resolution`)
        .auth(reporter, { type: 'bearer' })
        .send({ resolution: 'fixed' })
        .expect(403);
      const detail = await request(http)
        .get(`/admin/support/reports/${ref}`)
        .auth(admin, { type: 'bearer' })
        .expect(200);
      expect(detail.body.description).toBe('A refused create');
      await request(http)
        .post(`/admin/support/reports/${ref}/resolution`)
        .auth(admin, { type: 'bearer' })
        .send({ resolution: 'A workaround is available' })
        .expect(201);
      const own = await request(http).get(`/support/reports/${ref}`).auth(reporter, { type: 'bearer' }).expect(200);
      expect(own.body.resolutionEmail).toBe('pending');
      expect(own.body.resolution).toBeUndefined();
      await pool.query("UPDATE support_cases SET expires_at=now()-interval '1 second' WHERE reference=$1", [ref]);
      await request(http).get(`/support/reports/${ref}`).auth(reporter, { type: 'bearer' }).expect(404);
      await request(http)
        .post(`/admin/support/reports/${ref}/resolution`)
        .auth(admin, { type: 'bearer' })
        .send({ resolution: 'too late' })
        .expect(404);
    });
  },
);
