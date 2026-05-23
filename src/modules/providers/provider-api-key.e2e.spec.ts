/**
 * Provider-scoped API key e2e — full lifecycle against live Postgres.
 *
 *   1. Super-admin creates two test providers (Alpha + Beta).
 *   2. POST /admin/providers/:id/keys mints a `pkey_live_*` key.
 *   3. The plaintext key authenticates GET /provider-key/self.
 *   4. POST /provider-key/tournaments saves a tournament; subsequent GET round-trips it.
 *   5. Reading another provider's tournament returns 404 (cross-provider isolation).
 *   6. Saving a tournament whose parentOrganisation points at another provider returns "Provider mismatch".
 *   7. DELETE revokes the key; the same key now 401s.
 *
 * Gated on STORAGE_PROVIDER=postgres so it skips in LevelDB CI.
 */
import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mocksEngine, tools } from 'tods-competition-factory';
import request from 'supertest';

import { saveAndCommit } from 'src/tests/helpers/saveAndCommit';
import { TEST_EMAIL, TEST_PASSWORD } from 'src/common/constants/test';

const SUFFIX = Date.now();
const ALPHA_ABBR = `PKEYALPHA${SUFFIX}`;
const BETA_ABBR = `PKEYBETA${SUFFIX}`;
const ALPHA_TOURNAMENT_ID = `pkey-alpha-${SUFFIX}`;
const BETA_TOURNAMENT_ID = `pkey-beta-${SUFFIX}`;

const e2eEnabled = process.env.STORAGE_PROVIDER === 'postgres';
const d = e2eEnabled ? describe : describe.skip;

d('Provider API Key E2E', () => {
  let app: INestApplication;
  let server: any;
  let token: string;
  let alphaProviderId: string;
  let betaProviderId: string;
  let alphaKey: string;
  let alphaKeyId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();

    const login = await request(server)
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);
    token = login.body.token;

    const alphaRes = await request(server)
      .post('/provider/add')
      .set('Authorization', `Bearer ${token}`)
      .send({ organisationAbbreviation: ALPHA_ABBR, organisationName: 'Provider Key Alpha' })
      .expect(200);
    alphaProviderId = alphaRes.body.providerId;

    const betaRes = await request(server)
      .post('/provider/add')
      .set('Authorization', `Bearer ${token}`)
      .send({ organisationAbbreviation: BETA_ABBR, organisationName: 'Provider Key Beta' })
      .expect(200);
    betaProviderId = betaRes.body.providerId;

    // Seed one tournament under Beta so the cross-provider isolation
    // test has something existing to attempt to read.
    const { tournamentRecord: betaT } = mocksEngine.generateTournamentRecord({
      tournamentAttributes: {
        tournamentId: BETA_TOURNAMENT_ID,
        tournamentName: 'Beta seed',
        parentOrganisation: {
          organisationId: betaProviderId,
          organisationName: 'Provider Key Beta',
          organisationAbbreviation: BETA_ABBR,
        },
      },
    });
    await saveAndCommit(server, token, betaT);
  });

  afterAll(async () => {
    try {
      const { PROVIDER_STORAGE, CALENDAR_STORAGE } = await import('src/storage/interfaces');
      const providerStorage = app.get(PROVIDER_STORAGE);
      const calendarStorage = app.get(CALENDAR_STORAGE);
      for (const [pid, abbr] of [
        [alphaProviderId, ALPHA_ABBR],
        [betaProviderId, BETA_ABBR],
      ] as const) {
        if (pid) await providerStorage.removeProvider(pid).catch(() => undefined);
        if (abbr) await calendarStorage.setCalendar(abbr, { provider: {}, tournaments: [] }).catch(() => undefined);
      }
    } finally {
      await app.close();
    }
  });

  it('mints a pkey_live_ key for a provider and reveals plaintext once', async () => {
    const res = await request(server)
      .post(`/admin/providers/${alphaProviderId}/keys`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'alpha-prod' })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.apiKey).toMatch(/^pkey_live_[0-9a-f]{64}$/);
    expect(res.body.keyId).toBeDefined();
    alphaKey = res.body.apiKey;
    alphaKeyId = res.body.keyId;

    // Listing should show the key (without exposing the hash).
    const list = await request(server)
      .get(`/admin/providers/${alphaProviderId}/keys`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const k = list.body.keys.find((x: any) => x.keyId === alphaKeyId);
    expect(k).toBeDefined();
    expect(k.label).toBe('alpha-prod');
    expect(k.prefix).toBe('pkey_live_');
    expect((k as any).apiKeyHash).toBeUndefined();
  });

  it('authenticates GET /provider-key/self with the minted key', async () => {
    const res = await request(server)
      .get('/provider-key/self')
      .set('Authorization', `Bearer ${alphaKey}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.provider.providerId).toBe(alphaProviderId);
    expect(res.body.provider.keyId).toBe(alphaKeyId);
  });

  it('rejects /provider-key/self when no key (or wrong key) is presented', async () => {
    await request(server).get('/provider-key/self').expect(401);
    await request(server)
      .get('/provider-key/self')
      .set('Authorization', `Bearer pkey_live_${tools.UUID().replace(/-/g, '')}deadbeef`)
      .expect(401);
  });

  it('round-trips a tournament: POST then GET', async () => {
    const { tournamentRecord: alphaT } = mocksEngine.generateTournamentRecord({
      tournamentAttributes: {
        tournamentId: ALPHA_TOURNAMENT_ID,
        tournamentName: 'Alpha pkey tournament',
        parentOrganisation: {
          organisationId: alphaProviderId,
          organisationName: 'Provider Key Alpha',
          organisationAbbreviation: ALPHA_ABBR,
        },
      },
    });
    const save = await request(server)
      .post('/provider-key/tournaments')
      .set('Authorization', `Bearer ${alphaKey}`)
      .send({ tournamentRecord: alphaT })
      .expect(200);
    expect(save.body.success).toBe(true);

    const read = await request(server)
      .get(`/provider-key/tournaments/${ALPHA_TOURNAMENT_ID}`)
      .set('Authorization', `Bearer ${alphaKey}`)
      .expect(200);
    expect(read.body.tournamentRecord.tournamentId).toBe(ALPHA_TOURNAMENT_ID);
  });

  it('returns 404 (not 403) when probing for another provider\'s tournament', async () => {
    await request(server)
      .get(`/provider-key/tournaments/${BETA_TOURNAMENT_ID}`)
      .set('Authorization', `Bearer ${alphaKey}`)
      .expect(404);
  });

  it('refuses to save a tournament whose parentOrganisation points at another provider', async () => {
    const { tournamentRecord: spoof } = mocksEngine.generateTournamentRecord({
      tournamentAttributes: {
        tournamentId: `spoof-${SUFFIX}`,
        tournamentName: 'Spoof',
        parentOrganisation: {
          organisationId: betaProviderId,
          organisationName: 'Provider Key Beta',
          organisationAbbreviation: BETA_ABBR,
        },
      },
    });
    const res = await request(server)
      .post('/provider-key/tournaments')
      .set('Authorization', `Bearer ${alphaKey}`)
      .send({ tournamentRecord: spoof })
      .expect(200);
    // Response is shaped as an error object, not an HTTP 4xx — matches
    // factory's existing convention of returning `{ error: '...' }`.
    expect(res.body.error).toBe('Provider mismatch');
  });

  it('revokes the key and stops authenticating with it', async () => {
    await request(server)
      .delete(`/admin/providers/${alphaProviderId}/keys/${alphaKeyId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(server).get('/provider-key/self').set('Authorization', `Bearer ${alphaKey}`).expect(401);
  });
});
