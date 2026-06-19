/**
 * Regression test for the provisioner user-administration loophole.
 *
 * ProvisionerMiddleware injects a synthetic user with roles:[CLIENT,…] and a
 * synthetic providerRoles[P]=PROVIDER_ADMIN for the impersonated provider so
 * tournament/score endpoints work unchanged. That synthetic PROVIDER_ADMIN role
 * ALSO satisfied `assertProviderEditor`, which let a bare `prov_` API key +
 * `X-Provider-Id` reach the user-administration endpoints
 * (`/auth/admin-create-user`, `/auth/admin-reset-password`, the
 * `/provisioner/users/:userId/providers` mutations) — an unintended side door.
 *
 * The fix threads `isProvisioner` into `assertProviderEditor`; for
 * provisioner-authenticated requests the synthetic role is ignored and authority
 * must come from a real provisioner→provider relationship (which an API key,
 * carrying no provisionerIds, never has). This test pins that an API-key
 * provisioner is now rejected while:
 *   - the provisioner's legitimate (non-user-admin) surface still works, and
 *   - SUPER_ADMIN can still create users through the same endpoint.
 *
 * Requires STORAGE_PROVIDER=postgres + Redis (same as the other provisioner e2e).
 */
import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { TEST_EMAIL, TEST_PASSWORD } from 'src/common/constants/test';

const e2eEnabled = process.env.STORAGE_PROVIDER === 'postgres';
const d = e2eEnabled ? describe : describe.skip;

d('Provisioner / user-administration loophole', () => {
  let app: INestApplication;
  let adminToken: string;
  let provisionerId: string;
  let apiKey: string;
  let providerId: string;
  const createdUserEmails: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const httpServer = app.getHttpServer();
    httpServer.keepAliveTimeout = 0;
    httpServer.headersTimeout = 0;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.token;

    const provRes = await request(app.getHttpServer())
      .post('/admin/provisioners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `E2E-Loophole-${Date.now()}`, config: { test: true } })
      .expect(201);
    provisionerId = provRes.body.provisioner.provisionerId;

    const keyRes = await request(app.getHttpServer())
      .post(`/admin/provisioners/${provisionerId}/keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'e2e-loophole' })
      .expect(201);
    apiKey = keyRes.body.apiKey;

    // Provider created via the provisioner endpoint → 'owner' relationship.
    const provider = await request(app.getHttpServer())
      .post('/provisioner/providers')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ organisationAbbreviation: `EL${Date.now()}`, organisationName: 'E2E Loophole Provider' })
      .expect(201);
    providerId = provider.body.providerId;
  });

  afterAll(async () => {
    try {
      // Remove any users created by the SUPER_ADMIN control case.
      for (const email of createdUserEmails) {
        try {
          await request(app.getHttpServer())
            .post('/auth/remove')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ email });
        } catch {
          /* ignore */
        }
      }

      if (provisionerId && adminToken) {
        try {
          await request(app.getHttpServer())
            .put(`/admin/provisioners/${provisionerId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ isActive: false });
          await request(app.getHttpServer())
            .delete(`/admin/provisioners/${provisionerId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        } catch {
          /* ignore */
        }
      }

      const { PROVIDER_STORAGE } = await import('src/storage/interfaces');
      const providerStorage: any = app.get(PROVIDER_STORAGE);
      try { if (providerId) await providerStorage.removeProvider(providerId); } catch { /* ignore */ }
    } finally {
      await app.close();
    }
  });

  it('rejects API-key provisioner creating a user via /auth/admin-create-user (loophole closed)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/admin-create-user')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Provider-Id', providerId)
      .send({
        email: `loophole-${Date.now()}@example.com`,
        providerId,
        providerRole: 'DIRECTOR',
      });

    expect(res.status).toBe(403);
    expect(res.body?.success).toBeUndefined();
  });

  it('rejects API-key provisioner resetting a password via /auth/admin-reset-password', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/admin-reset-password')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Provider-Id', providerId)
      .send({ email: TEST_EMAIL });

    // The synthetic PROVIDER_ADMIN no longer authorises; SUPER_ADMIN is the
    // only editor the target (TEST_EMAIL) would resolve to, which the API key
    // is not. Authorization fails before any reset occurs.
    expect(res.status).toBe(403);
  });

  it('rejects API-key provisioner mutating user_providers associations', async () => {
    const res = await request(app.getHttpServer())
      .put(`/provisioner/users/00000000-0000-0000-0000-0000000000aa/providers/${providerId}`)
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Provider-Id', providerId)
      .send({ providerRole: 'PROVIDER_ADMIN' });

    expect(res.status).toBe(403);
  });

  it('still allows the API-key provisioner its legitimate surface (providers directory)', async () => {
    const res = await request(app.getHttpServer())
      .get('/provisioner/providers')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Provider-Id', providerId)
      .expect(200);

    expect(Array.isArray(res.body) || Array.isArray(res.body?.providers)).toBe(true);
  });

  it('still allows SUPER_ADMIN to create a user via the same endpoint', async () => {
    const email = `admin-created-${Date.now()}@example.com`;
    const res = await request(app.getHttpServer())
      .post('/auth/admin-create-user')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, providerId, providerRole: 'DIRECTOR' }) // no contactEmail → clipboard path, no mail sent
      .expect(200);

    expect(res.body?.success).toBe(true);
    expect(res.body?.mode).toBe('password-returned');
    createdUserEmails.push(email);
  });
});
