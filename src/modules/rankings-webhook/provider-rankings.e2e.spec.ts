import { createServer, type Server } from 'http';
import { AddressInfo } from 'net';

import { mocksEngine } from 'tods-competition-factory';
import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';

import { PROVIDER_STORAGE, type IProviderStorage } from 'src/storage/interfaces';
import { PG_POOL } from 'src/storage/postgres/postgres.config';

// Hermetic: seeds its own superadmin + provider + tournaments, and stands up a
// stub "rankings pipeline" (records ingest + snapshot POSTs) so the FULL CFS
// orchestration is exercised against the real app + Postgres without the real
// courthive-rankings service. RANKINGS_PIPELINE_URL is read at service
// construction, so the stub must be listening + the env set BEFORE app boot.
const ADMIN_EMAIL = 'e2e-rankings-admin@courthive.test';
const ADMIN_PASSWORD = 'e2e-verify-pass';
const PROVIDER_ID = 'e2e-rankings-provider';
const PROVIDER_ABBR = 'E2ERANK';
const tid = (s: string) => `test-rankings-e2e-${s}`;

describe('provider rankings recompute (e2e)', () => {
  let app: INestApplication;
  let server: any;
  let pool: any;
  let token: string;
  let stub: Server;
  const ingestCalls: any[] = [];
  const snapshotCalls: any[] = [];

  const auth = () => ({ Authorization: `Bearer ${token}` });

  function ownedTournament(tournamentId: string) {
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      tournamentAttributes: { tournamentId },
      drawProfiles: [{ drawSize: 4 }],
    });
    tournamentRecord.startDate = '2026-07-10';
    tournamentRecord.endDate = '2026-07-12';
    tournamentRecord.parentOrganisation = { organisationId: PROVIDER_ID };
    return tournamentRecord;
  }

  beforeAll(async () => {
    // Stub rankings pipeline — records POSTs, returns canned bodies.
    stub = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        if (req.url === '/tournaments/ingest') {
          ingestCalls.push(body);
          res.writeHead(202, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ingestionRunId: `run-${ingestCalls.length}`, awardCount: 7 }));
        } else if (req.url === '/rankings/snapshots') {
          snapshotCalls.push(body);
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ snapshotId: `snap-${snapshotCalls.length}` }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const port = (stub.address() as AddressInfo).port;
    process.env.RANKINGS_PIPELINE_URL = `http://127.0.0.1:${port}`;

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    pool = app.get(PG_POOL);

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await pool.query(
      `INSERT INTO users (email, password, roles, permissions, data, must_change_password, email_verified_at, updated_at)
       VALUES ($1, $2, $3, '{}'::jsonb, '{}'::jsonb, false, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, roles = EXCLUDED.roles,
         must_change_password = false, email_verified_at = NOW()`,
      [ADMIN_EMAIL, passwordHash, JSON.stringify(['superadmin', 'admin', 'client'])],
    );
    token = (await request(server).post('/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).body.token;
    expect(token).toBeTruthy();

    // Clean slate + seed provider (needs an abbreviation for calendar + policy routing).
    await pool.query(`DELETE FROM tournaments WHERE tournament_id LIKE 'test-rankings-e2e-%'`).catch(() => {});
    await pool.query(`DELETE FROM calendars WHERE provider_abbr = $1`, [PROVIDER_ABBR]).catch(() => {});
    const providerStorage = app.get<IProviderStorage>(PROVIDER_STORAGE);
    await providerStorage.setProvider(PROVIDER_ID, {
      organisationAbbreviation: PROVIDER_ABBR,
      organisationName: 'E2E Rankings Provider',
    });

    // Create two provider-owned tournaments (land them in the provider calendar).
    for (const s of ['a', 'b']) {
      await request(server).post('/factory/save').set(auth()).send({ tournamentRecord: ownedTournament(tid(s)) }).expect(200);
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tournaments WHERE tournament_id LIKE 'test-rankings-e2e-%'`).catch(() => {});
    await pool.query(`DELETE FROM calendars WHERE provider_abbr = $1`, [PROVIDER_ABBR]).catch(() => {});
    await pool.query(`DELETE FROM providers WHERE provider_id = $1`, [PROVIDER_ID]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE email = $1`, [ADMIN_EMAIL]).catch(() => {});
    await app.close();
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    delete process.env.RANKINGS_PIPELINE_URL;
  });

  it('rejects an unauthenticated caller', async () => {
    await request(server).post(`/admin/rankings-webhook/republish-provider/${PROVIDER_ID}`).send({}).expect(401);
  });

  it('republishes every provider tournament and generates M/F snapshots, returning a summary', async () => {
    ingestCalls.length = 0;
    snapshotCalls.length = 0;

    const res = await request(server)
      .post(`/admin/rankings-webhook/republish-provider/${PROVIDER_ID}`)
      .set(auth())
      .send({})
      .expect(200);

    // Both tournaments were pushed to the stub ingest endpoint.
    expect(ingestCalls).toHaveLength(2);
    const ingestedIds = ingestCalls.map((c) => c.tournamentRecord?.tournamentId).sort();
    expect(ingestedIds).toEqual([tid('a'), tid('b')]);

    // All-ages M + F snapshots, each carrying the provider abbr for policy routing.
    expect(snapshotCalls).toHaveLength(2);
    expect(snapshotCalls.map((c) => c.gender).sort()).toEqual(['FEMALE', 'MALE']);
    for (const c of snapshotCalls) {
      expect(c.tournamentRecord?.unifiedTournamentId?.organisation?.organisationId).toBe(PROVIDER_ABBR);
    }

    expect(res.body.counts).toMatchObject({ tournaments: 2, republishedOk: 2, snapshotsOk: 2 });
  });

  it('expands snapshots across requested age categories × gender', async () => {
    snapshotCalls.length = 0;
    const res = await request(server)
      .post(`/admin/rankings-webhook/republish-provider/${PROVIDER_ID}`)
      .set(auth())
      .send({ ageCategoryCodes: ['OPEN', 'U18'] })
      .expect(200);

    // 2 categories × 2 genders = 4 snapshots.
    expect(snapshotCalls).toHaveLength(4);
    expect(res.body.counts.snapshotsOk).toBe(4);
  });
});
