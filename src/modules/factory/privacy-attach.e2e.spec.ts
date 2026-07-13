import { mocksEngine, factoryConstants, fixtures } from 'tods-competition-factory';
import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';

import { PROVIDER_STORAGE, type IProviderStorage } from 'src/storage/interfaces';
import { PG_POOL } from 'src/storage/postgres/postgres.config';

const POLICY_TYPE_PARTICIPANT = factoryConstants.policyConstants.POLICY_TYPE_PARTICIPANT;

// Hermetic: the spec seeds its own superadmin (below) so it needs no external
// user fixture — only Postgres + Redis, which the app itself requires.
const ADMIN_EMAIL = 'e2e-privacy-admin@courthive.test';
const ADMIN_PASSWORD = 'e2e-verify-pass';

const PROVIDER_ID = 'e2e-privacy-provider';
const PROVIDER_ABBR = 'E2EPRIV';
const tid = (suffix: string) => `test-privacy-e2e-${suffix}`;

// A realistic participant-privacy policy (inner value shape, as stored in
// settings.participantPrivacyPolicy), tagged so we can assert it round-tripped.
const basePrivacy: any = fixtures.policies.POLICY_PRIVACY_DEFAULT[POLICY_TYPE_PARTICIPANT];
const privacyPolicy = { ...basePrivacy, policyName: 'E2E Privacy' };

function participantPolicyOn(record: any) {
  const applied = record?.extensions?.find((e: any) => e.name === 'appliedPolicies')?.value;
  return applied?.[POLICY_TYPE_PARTICIPANT];
}

function ownedTournament(tournamentId: string, startDate: string, endDate: string) {
  const { tournamentRecord } = mocksEngine.generateTournamentRecord({
    tournamentAttributes: { tournamentId, startDate, endDate },
    drawProfiles: [{ drawSize: 4 }],
  });
  // mocksEngine derives its own dates from the draw schedule, so pin the
  // tournament dates explicitly — the provider calendar (and apply-to-existing
  // classification) reads tournamentRecord.startDate/endDate.
  tournamentRecord.startDate = startDate;
  tournamentRecord.endDate = endDate;
  tournamentRecord.parentOrganisation = { organisationId: PROVIDER_ID };
  return tournamentRecord;
}

// Live-stack verification for Part A (privacy-policy attachment). Boots the real
// Nest app against Postgres + Redis and exercises the real HTTP endpoints — this
// is what catches storage-shape bugs the unit mocks can't (e.g. providerConfig*
// vs caps/settings). Seeds + tears down its own provider and tournaments.
describe('participant-privacy attachment (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let server: any;
  let pool: any;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const fetchRecord = async (tournamentId: string) => {
    const res = await request(server).post('/factory/fetch').set(auth()).send({ tournamentIds: [tournamentId] });
    return res.body?.tournamentRecords?.[tournamentId];
  };

  // Dates relative to "today" so classification is stable regardless of run date.
  // Must anchor on the real current date: the endpoint classifies upcoming vs
  // in-progress vs completed against today, so a hardcoded base becomes a time
  // bomb — once wall-clock passes base+10, the "upcoming" tournament starts on
  // or before today and reclassifies as in-progress (excluded when
  // includeInProgress is false), emptying `attached`.
  const iso = (offsetDays: number) => {
    const base = Date.now() + offsetDays * 86400000;
    return new Date(base).toISOString().split('T')[0];
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    pool = app.get(PG_POOL);

    // Seed a self-contained superadmin (bcrypt hash, verified, no forced change).
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await pool.query(
      `INSERT INTO users (email, password, roles, permissions, data, must_change_password, email_verified_at, updated_at)
       VALUES ($1, $2, $3, '{}'::jsonb, '{}'::jsonb, false, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET
         password = EXCLUDED.password, roles = EXCLUDED.roles,
         must_change_password = false, email_verified_at = NOW()`,
      [ADMIN_EMAIL, passwordHash, JSON.stringify(['superadmin', 'admin', 'client'])],
    );

    const loginReq = await request(server).post('/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    token = loginReq.body.token;
    expect(token).toBeTruthy();

    // Start from a clean slate (defends against leftovers from an aborted run).
    await pool.query(`DELETE FROM tournaments WHERE tournament_id LIKE 'test-privacy-e2e-%'`).catch(() => {});
    await pool.query(`DELETE FROM calendars WHERE provider_abbr = $1`, [PROVIDER_ABBR]).catch(() => {});

    // Seed the test provider WITHOUT a privacy policy initially.
    const providerStorage = app.get<IProviderStorage>(PROVIDER_STORAGE);
    await providerStorage.setProvider(PROVIDER_ID, {
      organisationAbbreviation: PROVIDER_ABBR,
      organisationName: 'E2E Privacy Provider',
    });
    await providerStorage.updateProviderSettings(PROVIDER_ID, {});
  });

  afterAll(async () => {
    // Clean up test rows regardless of assertions.
    await pool.query(`DELETE FROM tournaments WHERE tournament_id LIKE 'test-privacy-e2e-%'`).catch(() => {});
    await pool.query(`DELETE FROM calendars WHERE provider_abbr = $1`, [PROVIDER_ABBR]).catch(() => {});
    await pool.query(`DELETE FROM providers WHERE provider_id = $1`, [PROVIDER_ID]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE email = $1`, [ADMIN_EMAIL]).catch(() => {});
    await app.close();
  });

  it('does NOT attach on creation when the provider has no privacy policy', async () => {
    // Create both an upcoming and a completed tournament while the provider has
    // no policy configured, so both go into apply-to-existing policy-less.
    // (Creation attaches the CURRENT policy regardless of dates, so a policy-less
    // completed tournament can only exist if created before the policy is set.)
    await request(server)
      .post('/factory/save')
      .set(auth())
      .send({ tournamentRecord: ownedTournament(tid('upcoming'), iso(10), iso(15)) })
      .expect(200);
    await request(server)
      .post('/factory/save')
      .set(auth())
      .send({ tournamentRecord: ownedTournament(tid('completed'), iso(-30), iso(-20)) })
      .expect(200);

    expect(participantPolicyOn(await fetchRecord(tid('upcoming')))).toBeUndefined();
    expect(participantPolicyOn(await fetchRecord(tid('completed')))).toBeUndefined();
  });

  it('attaches the provider privacy policy on creation via /factory/save (REST create path)', async () => {
    // Configure the provider's privacy policy, then create a new tournament.
    const providerStorage = app.get<IProviderStorage>(PROVIDER_STORAGE);
    await providerStorage.updateProviderSettings(PROVIDER_ID, { participantPrivacyPolicy: privacyPolicy });

    await request(server)
      .post('/factory/save')
      .set(auth())
      .send({ tournamentRecord: ownedTournament(tid('created'), iso(20), iso(25)) })
      .expect(200);

    const record = await fetchRecord(tid('created'));
    const attached = participantPolicyOn(record);
    expect(attached).toBeTruthy();
    expect(attached.policyName).toBe('E2E Privacy');
  });

  it('apply-to-existing attaches to upcoming, reports already-attached, and never touches completed', async () => {
    // Going in: 'upcoming' + 'completed' are policy-less (created before the
    // policy); 'created' already carries it (attached on creation).
    const res = await request(server)
      .post('/factory/apply-privacy-policy')
      .set(auth())
      .send({ providerId: PROVIDER_ID, includeInProgress: false })
      .expect(200);

    const body = res.body;
    expect(body.success).toBe(true);
    // 'upcoming' had no policy → freshly attached; 'created' already had it.
    expect(body.attached).toContain(tid('upcoming'));
    expect(body.alreadyAttached).toContain(tid('created'));
    // Completed is never selected.
    expect(body.attached).not.toContain(tid('completed'));
    expect(body.alreadyAttached).not.toContain(tid('completed'));

    // Verify persisted state matches the report.
    expect(participantPolicyOn(await fetchRecord(tid('upcoming')))?.policyName).toBe('E2E Privacy');
    expect(participantPolicyOn(await fetchRecord(tid('completed')))).toBeUndefined();
  });

  it('rejects apply-to-existing for a non-provider-admin, non-superadmin caller', async () => {
    // No auth header → 401 from the guard (proves the endpoint is protected).
    await request(server)
      .post('/factory/apply-privacy-policy')
      .send({ providerId: PROVIDER_ID })
      .expect(401);
  });
});
