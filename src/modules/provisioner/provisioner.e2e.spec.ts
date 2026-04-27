import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { TEST_EMAIL, TEST_PASSWORD } from 'src/common/constants/test';

/**
 * End-to-end integration test for the full provisioner lifecycle.
 * Simulates an external provisioner (like IONSport) from onboarding
 * through SSO login. Requires STORAGE_PROVIDER=postgres and Redis.
 */
describe('Provisioner E2E', () => {
  let app: INestApplication;
  let adminToken: string;
  let provisionerId: string;
  let apiKey: string;
  let providerId: string;
  let ssoUserId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    // Get SUPER_ADMIN JWT
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.token;
  });

  afterAll(async () => {
    // Clean up test provisioner via the public API (deactivate then hard-delete
    // with cascade — wipes API keys, provider associations, and tournament
    // ownership stamps in one transaction). Without this, every spec run
    // leaves an `E2E-Provisioner-*` row in the dev DB; the cleanup script
    // exists because of an earlier session that ran this suite ~94 times.
    if (provisionerId && adminToken) {
      await request(app.getHttpServer())
        .put(`/admin/provisioners/${provisionerId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      await request(app.getHttpServer())
        .delete(`/admin/provisioners/${provisionerId}`)
        .set('Authorization', `Bearer ${adminToken}`);
    }

    // Provider rows survive provisioner cascade by design (providers and
    // tournaments are independent entities). Clean the test provider directly.
    if (providerId) {
      const { PROVIDER_STORAGE } = await import('src/storage/interfaces');
      const providerStorage = app.get(PROVIDER_STORAGE);
      await providerStorage.removeProvider(providerId);
    }
    await app.close();
  });

  // ── Phase 0: Provisioner onboarding (SUPER_ADMIN) ──

  it('creates a provisioner', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/provisioners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `E2E-Provisioner-${Date.now()}`, config: { test: true } })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.provisioner.provisionerId).toBeDefined();
    provisionerId = res.body.provisioner.provisionerId;
  });

  it('generates an API key', async () => {
    const res = await request(app.getHttpServer())
      .post(`/admin/provisioners/${provisionerId}/keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'e2e-test' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.apiKey).toMatch(/^prov_sk_live_/);
    apiKey = res.body.apiKey;
  });

  it('lists provisioners', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/provisioners')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.provisioners.length).toBeGreaterThanOrEqual(1);
    expect(res.body.provisioners.some((p) => p.provisionerId === provisionerId)).toBe(true);
  });

  // ── Phase 0: Provider management (Provisioner API key) ──

  it('rejects invalid API key', async () => {
    await request(app.getHttpServer())
      .get('/provisioner/providers')
      .set('Authorization', 'Bearer prov_sk_live_bogus')
      .expect(401);
  });

  it('lists provider directory', async () => {
    const res = await request(app.getHttpServer())
      .get('/provisioner/providers')
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);

    expect(Array.isArray(res.body.providers)).toBe(true);
    // None managed yet
    expect(res.body.providers.every((p) => !p.managed)).toBe(true);
  });

  it('creates a provider', async () => {
    const abbr = `E2E${Date.now()}`;
    const res = await request(app.getHttpServer())
      .post('/provisioner/providers')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        organisationAbbreviation: abbr,
        organisationName: 'E2E Test Provider',
        providerConfigCaps: {
          permissions: { canCreateOfficials: true, allowedDrawTypes: ['SE', 'RR'] },
          integrations: { ssoProvider: 'ioncourt' },
        },
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.providerId).toBeDefined();
    providerId = res.body.providerId;
  });

  it('shows provider as managed with caps + settings', async () => {
    const res = await request(app.getHttpServer())
      .get(`/provisioner/providers/${providerId}`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);

    expect(res.body.managed).toBe(true);
    expect(res.body.relationship).toBe('owner');
    expect(res.body.providerConfigCaps?.integrations?.ssoProvider).toBe('ioncourt');
    expect(res.body.providerConfigCaps?.permissions?.allowedDrawTypes).toEqual(['SE', 'RR']);
    // Settings starts empty for a freshly created provider
    expect(res.body.providerConfigSettings).toEqual({});
  });

  it('rejects duplicate abbreviation', async () => {
    const res = await request(app.getHttpServer())
      .post('/provisioner/providers')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ organisationAbbreviation: 'TMX', organisationName: 'Dup' });

    expect(res.body.error).toBeDefined();
  });

  // ── Phase 0: SSO user creation ──

  it('creates an SSO user', async () => {
    const email = `e2e-sso-${Date.now()}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/provisioner/users')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        providerId,
        externalId: `ext-e2e-${Date.now()}`,
        email,
        phone: '+1-555-0000',
        providerRole: 'DIRECTOR',
        ssoProvider: 'ioncourt',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.userId).toBeDefined();
    expect(res.body.providerRole).toBe('DIRECTOR');
    ssoUserId = res.body.userId;
  });

  it('lists users for the provider', async () => {
    const res = await request(app.getHttpServer())
      .get(`/provisioner/users?providerId=${providerId}`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);

    expect(res.body.users.length).toBeGreaterThanOrEqual(1);
    expect(res.body.users.some((u) => u.userId === ssoUserId)).toBe(true);
  });

  it('rejects SSO user direct login', async () => {
    const user = await request(app.getHttpServer())
      .get(`/provisioner/users?providerId=${providerId}`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);

    const ssoEmail = user.body.users.find((u) => u.userId === ssoUserId)?.email;
    if (ssoEmail) {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ssoEmail, password: 'anything' })
        .expect(401);

      expect(loginRes.body.message).toContain('SSO');
    }
  });

  // ── Phase 0: Impersonated tournament operations ──

  it('generates a tournament via impersonation', async () => {
    const res = await request(app.getHttpServer())
      .post('/factory/generate')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Provider-Id', providerId)
      .send({ tournamentName: 'E2E Provisioner Tournament', startDate: '2026-07-01', endDate: '2026-07-07' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.tournamentRecord.tournamentName).toBe('E2E Provisioner Tournament');
  });

  // ── Phase 0: Assignment management ──

  it('grants and revokes tournament assignment', async () => {
    // Generate a tournament first
    const genRes = await request(app.getHttpServer())
      .post('/factory/generate')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Provider-Id', providerId)
      .send({ tournamentName: 'Assignment Test', startDate: '2026-08-01', endDate: '2026-08-07' })
      .expect(200);

    const tournamentId = genRes.body.tournamentRecord.tournamentId;
    const userEmail = (await request(app.getHttpServer())
      .get(`/provisioner/users?providerId=${providerId}`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200)).body.users[0].email;

    // Grant
    const grantRes = await request(app.getHttpServer())
      .post('/provisioner/assignments/grant')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ tournamentId, userEmail, providerId, role: 'DIRECTOR' })
      .expect(200);

    expect(grantRes.body.success).toBe(true);

    // List
    const listRes = await request(app.getHttpServer())
      .post('/provisioner/assignments/list')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ tournamentId, providerId })
      .expect(200);

    expect(listRes.body.assignments.length).toBe(1);

    // Revoke
    const revokeRes = await request(app.getHttpServer())
      .post('/provisioner/assignments/revoke')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ tournamentId, userEmail, providerId })
      .expect(200);

    expect(revokeRes.body.success).toBe(true);
  });

  // ── Phase 1: SSO token flow ──

  it('generates SSO token and exchanges for JWT', async () => {
    // Get the SSO user's external ID
    const usersRes = await request(app.getHttpServer())
      .get(`/provisioner/users?providerId=${providerId}`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);

    const ssoUser = usersRes.body.users.find((u) => u.userId === ssoUserId);

    // Generate token
    const genRes = await request(app.getHttpServer())
      .post('/auth/sso/generate')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ externalId: ssoUser.externalId, ssoProvider: 'ioncourt', providerId })
      .expect(200);

    expect(genRes.body.token).toBeDefined();
    expect(genRes.body.expiresIn).toBe(60);

    // Exchange token for JWT (public endpoint — no auth header)
    const loginRes = await request(app.getHttpServer())
      .post('/auth/sso/login-with-token')
      .send({ token: genRes.body.token })
      .expect(200);

    expect(loginRes.body.accessToken).toBeDefined();
    expect(loginRes.body.user.userId).toBe(ssoUserId);
    expect(loginRes.body.user.providerIds).toContain(providerId);

    // Verify the JWT works on a protected endpoint
    const protectedRes = await request(app.getHttpServer())
      .get('/factory/version')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(200);

    expect(protectedRes.body.version).toBeDefined();

    // Verify replay protection — same token should fail
    const replayRes = await request(app.getHttpServer())
      .post('/auth/sso/login-with-token')
      .send({ token: genRes.body.token })
      .expect(200);

    expect(replayRes.body.error).toContain('expired or not found');
  });
});
