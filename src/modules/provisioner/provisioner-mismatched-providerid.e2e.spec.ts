/**
 * Discovery / regression test for the IONSport incident on 2026-05-29.
 *
 * IONSport reported creating two tournaments with the "wrong" X-Provider-Id
 * (a providerId for one of their other owned providers, ION, instead of
 * BOBOCA). Those tournaments did NOT appear in TMX. A third tournament with
 * the correct BOBOCA X-Provider-Id was then created, and all three appeared
 * when the user viewed the BOBOCA calendar (while "impersonating" BOBOCA).
 *
 * This test reproduces the conditions locally and asserts the actual
 * behaviour so future regressions are caught. Specifically it pins down:
 *
 *   A. What happens when X-Provider-Id refers to a provider the provisioner
 *      doesn't own (relationship lookup returns null)?
 *   B. What happens when X-Provider-Id refers to a provider that doesn't
 *      exist at all (random UUID)?
 *   C. When X-Provider-Id resolves to an owned-but-"wrong" provider, where
 *      does the tournament land — which provider's calendar, and is the
 *      `tournament_provisioner` row written?
 *   D. After a "right" call, do prior "wrong" tournaments suddenly become
 *      visible via the right provider's calendar?
 *
 * Requires STORAGE_PROVIDER=postgres + Redis (same as provisioner.e2e).
 */
import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { TEST_EMAIL, TEST_PASSWORD } from 'src/common/constants/test';

const e2eEnabled = process.env.STORAGE_PROVIDER === 'postgres';
const d = e2eEnabled ? describe : describe.skip;

const RANDOM_BAD_PROVIDER_ID = '00000000-0000-0000-0000-000000000001';

d('Provisioner / mismatched X-Provider-Id', () => {
  let app: INestApplication;
  let adminToken: string;
  let provisionerId: string;
  let apiKey: string;
  let bobocaId: string;
  let bobocaAbbr: string;
  let ionId: string;
  let ionAbbr: string;
  const createdTournamentIds: string[] = [];

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

    // 1. Create a provisioner that mirrors IONSport.
    const provRes = await request(app.getHttpServer())
      .post('/admin/provisioners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `E2E-IONSport-${Date.now()}`, config: { test: true } })
      .expect(201);
    provisionerId = provRes.body.provisioner.provisionerId;

    // 2. Mint an API key for it.
    const keyRes = await request(app.getHttpServer())
      .post(`/admin/provisioners/${provisionerId}/keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'e2e-mismatch' })
      .expect(201);
    apiKey = keyRes.body.apiKey;

    // 3. Create two providers via the provisioner endpoint — both end up
    //    with an 'owner' relationship to the provisioner. These stand in
    //    for BOBOCA and ION (both real IONSport-owned providers in prod).
    bobocaAbbr = `EB${Date.now()}`;
    const bobocaRes = await request(app.getHttpServer())
      .post('/provisioner/providers')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ organisationAbbreviation: bobocaAbbr, organisationName: 'E2E Battle of Boca' })
      .expect(201);
    bobocaId = bobocaRes.body.providerId;

    ionAbbr = `EI${Date.now()}`;
    const ionRes = await request(app.getHttpServer())
      .post('/provisioner/providers')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ organisationAbbreviation: ionAbbr, organisationName: 'E2E IONSport Demos' })
      .expect(201);
    ionId = ionRes.body.providerId;
  });

  afterAll(async () => {
    try {
      if (adminToken && createdTournamentIds.length > 0) {
        for (const tournamentId of createdTournamentIds) {
          try {
            await request(app.getHttpServer())
              .post('/factory/remove')
              .set('Authorization', `Bearer ${adminToken}`)
              .send({ tournamentId, providerId: bobocaId });
          } catch {
            /* ignore */
          }
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
      for (const pid of [bobocaId, ionId]) {
        try { if (pid) await providerStorage.removeProvider(pid); } catch { /* ignore */ }
      }
    } finally {
      await app.close();
    }
  });

  // ── A. Provider that doesn't exist at all ──

  it('A. non-existent providerId → 403 (RolesGuard rejects: no synthetic user injected)', async () => {
    const res = await request(app.getHttpServer())
      .post('/factory/generate')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Provider-Id', RANDOM_BAD_PROVIDER_ID)
      .send({ tournamentName: 'A: bad providerId', startDate: '2026-08-01', endDate: '2026-08-03' });

    console.log(`[A] status=${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`);
    // Middleware does not inject req.user when getRelationship returns null;
    // RolesGuard then sees user=undefined and 403s. No tournament created.
    expect(res.status).toBe(403);
    expect(res.body?.tournamentRecord).toBeUndefined();
  });

  // ── B. Provider that exists but is owned by a different provisioner ──

  it('B. X-Provider-Id of a provider not owned by this provisioner — same outcome as (A)', async () => {
    // Create an unrelated provider (no relationship to our provisioner) by
    // using the super-admin REST endpoint directly.
    const otherAbbr = `EX${Date.now()}`;
    const otherRes = await request(app.getHttpServer())
      .post('/provider/add')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ organisationAbbreviation: otherAbbr, organisationName: 'E2E Unrelated' });
    const otherProviderId: string | undefined =
      otherRes.body?.providerId ?? otherRes.body?.provider?.organisationId;

    try {
      const res = await request(app.getHttpServer())
        .post('/factory/generate')
        .set('Authorization', `Bearer ${apiKey}`)
        .set('X-Provider-Id', otherProviderId || RANDOM_BAD_PROVIDER_ID)
        .send({ tournamentName: 'B: unrelated providerId', startDate: '2026-08-04', endDate: '2026-08-06' });

      console.log(`[B] status=${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`);
      // Same path as (A): provider exists but no provisioner_providers row,
      // so getRelationship returns null → 403.
      expect(res.status).toBe(403);
      expect(res.body?.tournamentRecord).toBeUndefined();
    } finally {
      if (otherProviderId) {
        const { PROVIDER_STORAGE } = await import('src/storage/interfaces');
        const providerStorage: any = app.get(PROVIDER_STORAGE);
        try { await providerStorage.removeProvider(otherProviderId); } catch { /* ignore */ }
      }
    }
  });

  // ── C. The IONSport scenario — owned-but-"wrong" provider ──

  it('C1. Generate with X-Provider-Id=ION (owned, intended-for-BOBOCA) — tournament A', async () => {
    const res = await request(app.getHttpServer())
      .post('/factory/generate')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Provider-Id', ionId)
      .send({ tournamentName: 'C1: meant for BOBOCA, sent ION', startDate: '2026-08-10', endDate: '2026-08-12' });

     
    console.log(`[C1] status=${res.status} success=${res.body?.success} tid=${res.body?.tournamentRecord?.tournamentId} parentOrg=${JSON.stringify(res.body?.tournamentRecord?.parentOrganisation)}`);
    expect(res.status).toBe(200);
    if (res.body?.tournamentRecord?.tournamentId) createdTournamentIds.push(res.body.tournamentRecord.tournamentId);
  });

  it('C2. Generate with X-Provider-Id=ION (owned, intended-for-BOBOCA) — tournament B', async () => {
    const res = await request(app.getHttpServer())
      .post('/factory/generate')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Provider-Id', ionId)
      .send({ tournamentName: 'C2: meant for BOBOCA, sent ION', startDate: '2026-08-13', endDate: '2026-08-15' });

     
    console.log(`[C2] status=${res.status} success=${res.body?.success} tid=${res.body?.tournamentRecord?.tournamentId}`);
    expect(res.status).toBe(200);
    if (res.body?.tournamentRecord?.tournamentId) createdTournamentIds.push(res.body.tournamentRecord.tournamentId);
  });

  it('C3. Generate with X-Provider-Id=BOBOCA (correct) — tournament C', async () => {
    const res = await request(app.getHttpServer())
      .post('/factory/generate')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Provider-Id', bobocaId)
      .send({ tournamentName: 'C3: correct BOBOCA', startDate: '2026-08-16', endDate: '2026-08-18' });

     
    console.log(`[C3] status=${res.status} success=${res.body?.success} tid=${res.body?.tournamentRecord?.tournamentId}`);
    expect(res.status).toBe(200);
    if (res.body?.tournamentRecord?.tournamentId) createdTournamentIds.push(res.body.tournamentRecord.tournamentId);
  });

  // ── D. What ended up where? ──

  it('Dprep. settle: wait out the fire-and-forget save in factory.service.generateTournamentRecord', async () => {
    // generateTournamentRecord returns success before saveTournamentRecords
    // resolves (factory.service.ts:75 — `this.tournamentStorageService.save...catch(...)`).
    // Without a settle wait, the calendar queries below can race and miss the
    // most-recent tournament. This is itself a finding: in prod, a client that
    // immediately queries after a create can observe a brief gap.
    await new Promise((resolve) => setTimeout(resolve, 800));
  });

  it('D1. ION calendar contains the two "wrong" tournaments (C1, C2)', async () => {
    const res = await request(app.getHttpServer())
      .post('/provider/calendar')
      .send({ providerAbbr: ionAbbr });
    expect(res.body?.success).toBe(true);
    const ts: any[] = res.body?.calendar?.tournaments ?? [];
    console.log(`[D1 ION calendar] count=${ts.length}`);
    // C1 and C2 both went here because user.providerId from the synthetic
    // user (= X-Provider-Id) became parentOrganisation.organisationId.
    expect(ts.length).toBeGreaterThanOrEqual(2);
  });

  it('D2. BOBOCA calendar contains the "correct" tournament (C3) only', async () => {
    const res = await request(app.getHttpServer())
      .post('/provider/calendar')
      .send({ providerAbbr: bobocaAbbr });
    expect(res.body?.success).toBe(true);
    const ts: any[] = res.body?.calendar?.tournaments ?? [];
    console.log(`[D2 BOBOCA calendar] count=${ts.length}`);
    // C3 — the only one created with X-Provider-Id=BOBOCA — should be the
    // only entry. detachFromOtherCalendars (tournament-storage.service.ts:230)
    // would have moved any aliased entry; here there's none to move.
    expect(ts.length).toBe(1);
  });

  it('D3. tournament_provisioner ownership rows are NOT written by /factory/generate', async () => {
    // Open finding: executionQueue's provisioner stamping (executionQueue.ts:74)
    // fires only for methods including 'newTournamentRecord'. /factory/generate
    // goes through factory.service.generateTournamentRecord which bypasses
    // executionQueue, so tournament_provisioner stays empty for these rows.
    // This means: tournaments created via /factory/generate carry no durable
    // provisioner-origin record, only the parentOrganisation.organisationId.
    const { TOURNAMENT_PROVISIONER_STORAGE } = await import('src/storage/interfaces');
    const tps: any = app.get(TOURNAMENT_PROVISIONER_STORAGE);
    for (const tid of createdTournamentIds) {
      const row = await tps.getByTournament(tid);
      console.log(`[D3] ${tid.slice(0, 8)}… -> ${JSON.stringify(row)}`);
      expect(row).toBeNull();
    }
  });

  it('D4. parentOrganisation reflects X-Provider-Id at create time, not intent', async () => {
    const seen: Record<string, string> = {};
    for (const tid of createdTournamentIds) {
      const res = await request(app.getHttpServer())
        .post('/factory/fetch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tournamentIds: [tid] });
      const rec = res.body?.tournamentRecords?.[tid] ?? res.body?.tournamentRecord;
      const parentOrgId = rec?.parentOrganisation?.organisationId;
      const tag = parentOrgId === bobocaId ? 'BOBOCA' : parentOrgId === ionId ? 'ION' : '(other)';
      seen[tid] = tag;
      console.log(`[D4] ${tid.slice(0, 8)}… parentOrg=${parentOrgId ?? 'NONE'} (${tag})`);
    }
    const tags = Object.values(seen);
    expect(tags.filter((t) => t === 'ION').length).toBe(2);
    expect(tags.filter((t) => t === 'BOBOCA').length).toBe(1);
  });
});
