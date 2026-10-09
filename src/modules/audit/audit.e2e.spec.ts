/**
 * Audit trail end-to-end test.
 *
 * Boots the full AppModule against the live Postgres database.
 * Uses the super-admin test user (axel@castle.com) to:
 *   1. Create a test provider
 *   2. Save a tournament under that provider
 *   3. Mutate it via REST executionQueue + TMX socket executionQueue
 *   4. Verify audit rows are written and queryable for both paths
 *   5. Verify rejected mutations are captured with errorCode + full params
 *   6. Verify ackId correlation lands in metadata
 *   7. Delete the tournament; verify deletion audit row survives
 *   8. Clean up the test provider
 */
import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mocksEngine, tools } from 'tods-competition-factory';
import request from 'supertest';

import { saveAndCommit } from 'src/tests/helpers/saveAndCommit';
import { TEST_EMAIL, TEST_PASSWORD } from 'src/common/constants/test';

const AUDIT_TOURNAMENT_ID = `audit-e2e-${Date.now()}`;
const AUDIT_PROVIDER_ABBR = `AUDITE2E${Date.now()}`;

const e2eEnabled = process.env.STORAGE_PROVIDER === 'postgres';
const d = e2eEnabled ? describe : describe.skip;

d('Audit Trail E2E', () => {
  let app: INestApplication;
  let token: string;
  let providerId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    // Login as super-admin
    const loginReq = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);
    token = loginReq.body.token;

    // Create a test provider
    const providerResult = await request(app.getHttpServer())
      .post('/provider/add')
      .set('Authorization', `Bearer ${token}`)
      .send({
        organisationAbbreviation: AUDIT_PROVIDER_ABBR,
        organisationName: 'Audit E2E Test Provider',
      })
      .expect(200);
    providerId = providerResult.body.providerId;
  });

  afterAll(async () => {
    try {
      // Provider + calendar — keep separate try blocks so a failure on one
      // doesn't prevent the other (or `app.close()`) from running.
      if (providerId) {
        try {
          const { PROVIDER_STORAGE } = await import('src/storage/interfaces');
          const providerStorage = app.get(PROVIDER_STORAGE);
          await providerStorage.removeProvider(providerId);
        } catch (err) {
          console.warn('[audit.e2e] provider cleanup failed:', (err as Error).message);
        }

        try {
          const { CALENDAR_STORAGE } = await import('src/storage/interfaces');
          const calendarStorage = app.get(CALENDAR_STORAGE);
          // Migration 047: rows keyed by tournament, so clear this provider's rows by id.
          const listed = await calendarStorage.listProviderTournaments(providerId);
          for (const entry of listed) await calendarStorage.removeTournament(entry.tournamentId);
        } catch (err) {
          console.warn('[audit.e2e] calendar cleanup failed:', (err as Error).message);
        }
      }
    } finally {
      await app.close();
    }
  });

  it('records audit rows for mutations via executionQueue', async () => {
    // Save a tournament under the test provider
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      tournamentAttributes: {
        tournamentId: AUDIT_TOURNAMENT_ID,
        tournamentName: 'Audit Trail Test',
        parentOrganisation: {
          organisationId: providerId,
          organisationName: 'Audit E2E Test Provider',
          organisationAbbreviation: AUDIT_PROVIDER_ABBR,
        },
      },
    });

    await saveAndCommit(app.getHttpServer(), token, tournamentRecord);

    // Execute a mutation via the REST executionQueue
    const eqResult = await request(app.getHttpServer())
      .post('/factory')
      .set('Authorization', `Bearer ${token}`)
      .send({
        methods: [
          {
            method: 'setTournamentDates',
            params: {
              startDate: '2025-06-01',
              endDate: '2025-06-07',
              tournamentId: AUDIT_TOURNAMENT_ID,
            },
          },
        ],
        tournamentId: AUDIT_TOURNAMENT_ID,
      })
      .expect(200);
    expect(eqResult.body.success).toEqual(true);

    // Wait briefly for the async audit write to complete
    await new Promise((r) => setTimeout(r, 200));

    // Query audit trail — should have at least one MUTATION row
    const auditResult = await request(app.getHttpServer())
      .post('/audit/tournament')
      .set('Authorization', `Bearer ${token}`)
      .send({ tournamentId: AUDIT_TOURNAMENT_ID })
      .expect(200);

    expect(auditResult.body.success).toBe(true);
    const rows = auditResult.body.auditRows;
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const mutationRow = rows.find((r: any) => r.actionType === 'MUTATION');
    expect(mutationRow).toBeDefined();
    expect(mutationRow.tournamentId).toBe(AUDIT_TOURNAMENT_ID);
    expect(mutationRow.methods[0].method).toBe('setTournamentDates');
    expect(mutationRow.status).toBe('applied');
    expect(mutationRow.occurredAt).toBeDefined();
  });

  // ── The path TMX sends mutations on ──
  //
  // TMX sends every mutation as `POST /factory` (the socket executionQueue was retired on 2026-10-09).
  // These were written for the socket gateway, which bypassed the AuditService until 2026-05-22; they
  // now lock down the same three properties on the route TMX actually uses: a TMX-sourced applied row,
  // a rejected row with its error code and full params, and the client's ackId in the row's metadata.
  function sendExecutionQueue(payload: any): Promise<{ success?: boolean; error?: any }> {
    return request(app.getHttpServer())
      .post('/factory')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...payload, ackId: payload.ackId ?? tools.UUID() })
      .then((res) => {
        // A refusal is a non-2xx response whose body IS the error (checkEngineError's
        // { message, code, ... }, or the mutation gate's 403), as TMX's toCommandOutcome reads it.
        const ok = res.status >= 200 && res.status < 300;
        return ok ? res.body : { ...res.body, error: res.body?.error ?? res.body };
      });
  }

  it('records TMX-sourced audit rows for mutations sent as POST /factory', async () => {
    const ack = await sendExecutionQueue({
      methods: [
        {
          method: 'setTournamentDates',
          params: { startDate: '2025-06-02', endDate: '2025-06-08', tournamentId: AUDIT_TOURNAMENT_ID },
        },
      ],
      tournamentIds: [AUDIT_TOURNAMENT_ID],
    });
    expect(ack.success).toBe(true);

    await new Promise((r) => setTimeout(r, 250));

    const auditResult = await request(app.getHttpServer())
      .post('/audit/tournament')
      .set('Authorization', `Bearer ${token}`)
      .send({ tournamentId: AUDIT_TOURNAMENT_ID })
      .expect(200);

    // Find the TMX-sourced applied row for setTournamentDates with the
    // 2025-06-02 startDate that uniquely identifies this mutation
    // (the REST test above used 2025-06-01).
    const socketRow = auditResult.body.auditRows.find(
      (r: any) =>
        r.actionType === 'MUTATION' &&
        r.status === 'applied' &&
        r.methods?.[0]?.method === 'setTournamentDates' &&
        r.methods?.[0]?.params?.startDate === '2025-06-02',
    );
    expect(socketRow).toBeDefined();
    expect(socketRow.source).toBe('tmx');
    expect(socketRow.userEmail).toBe(TEST_EMAIL);
  });

  it('records rejected mutations with errorCode + full method params', async () => {
    // Deliberately target a courtId that doesn't exist — the exact
    // failure mode of the 2026-05-21 p.sychrovsky incident.
    const bogusCourtId = `bogus-court-${tools.UUID()}`;
    const ack = await sendExecutionQueue({
      methods: [
        {
          method: 'modifyCourt',
          params: { courtId: bogusCourtId, modifications: { courtName: 'Phantom' } },
        },
      ],
      tournamentIds: [AUDIT_TOURNAMENT_ID],
    });
    expect(ack.error).toBeDefined();

    await new Promise((r) => setTimeout(r, 250));

    const auditResult = await request(app.getHttpServer())
      .post('/audit/tournament')
      .set('Authorization', `Bearer ${token}`)
      .send({ tournamentId: AUDIT_TOURNAMENT_ID })
      .expect(200);

    const rejectedRow = auditResult.body.auditRows.find(
      (r: any) =>
        r.actionType === 'MUTATION' &&
        r.status === 'rejected' &&
        r.methods?.[0]?.method === 'modifyCourt' &&
        r.methods?.[0]?.params?.courtId === bogusCourtId,
    );
    expect(rejectedRow).toBeDefined();
    expect(rejectedRow.errorCode).toBeDefined();
    // The full failing params must be persisted — this is the whole
    // point of the audit log for postmortem.
    expect(rejectedRow.methods[0].params).toEqual({
      courtId: bogusCourtId,
      modifications: { courtName: 'Phantom' },
    });
  });

  it('stamps ackId from TMX payload into audit metadata', async () => {
    const ackId = `audit-corr-${tools.UUID()}`;
    const ack = await sendExecutionQueue({
      ackId,
      methods: [
        {
          method: 'setTournamentDates',
          params: { startDate: '2025-06-03', endDate: '2025-06-09', tournamentId: AUDIT_TOURNAMENT_ID },
        },
      ],
      tournamentIds: [AUDIT_TOURNAMENT_ID],
    });
    // The ack correlation is TMX's own over HTTP; the server's job is the audit metadata below.
    expect(ack.success).toBe(true);

    await new Promise((r) => setTimeout(r, 250));

    const auditResult = await request(app.getHttpServer())
      .post('/audit/tournament')
      .set('Authorization', `Bearer ${token}`)
      .send({ tournamentId: AUDIT_TOURNAMENT_ID })
      .expect(200);

    const correlatedRow = auditResult.body.auditRows.find((r: any) => r.metadata?.ackId === ackId);
    expect(correlatedRow).toBeDefined();
    expect(correlatedRow.status).toBe('applied');
  });

  it('restores a deleted draw from its audit snapshot (POST /audit/restore-draw)', async () => {
    const restoreTournamentId = `audit-restore-e2e-${Date.now()}`;
    const drawProfiles = [{ drawSize: 8, drawId: `restore-draw-${Date.now()}` }];
    const { tournamentRecord } = mocksEngine.generateTournamentRecord({
      tournamentAttributes: {
        tournamentId: restoreTournamentId,
        tournamentName: 'Audit Restore E2E',
        parentOrganisation: {
          organisationId: providerId,
          organisationName: 'Audit E2E Test Provider',
          organisationAbbreviation: AUDIT_PROVIDER_ABBR,
        },
      },
      drawProfiles,
    });
    const eventId = tournamentRecord.events?.[0]?.eventId;
    const drawId = tournamentRecord.events?.[0]?.drawDefinitions?.[0]?.drawId;
    expect(eventId).toBeDefined();
    expect(drawId).toBeDefined();

    try {
      await saveAndCommit(app.getHttpServer(), token, tournamentRecord);

      // Delete the draw via executionQueue — triggers the AUDIT topic
      // subscription that persists the deletedDrawSnapshot.
      const deleteResult = await request(app.getHttpServer())
        .post('/factory')
        .set('Authorization', `Bearer ${token}`)
        .send({
          methods: [{ method: 'deleteDrawDefinitions', params: { eventId, drawIds: [drawId] } }],
          tournamentId: restoreTournamentId,
        })
        .expect(200);
      expect(deleteResult.body.success).toBe(true);

      await new Promise((r) => setTimeout(r, 250));

      // Find the DELETE_DRAW audit row for our drawId
      const deletedDrawsResult = await request(app.getHttpServer())
        .post('/audit/deleted-draws')
        .set('Authorization', `Bearer ${token}`)
        .send({ tournamentId: restoreTournamentId })
        .expect(200);
      const deleteRow = deletedDrawsResult.body.auditRows.find((r: any) => r.metadata?.drawId === drawId);
      expect(deleteRow).toBeDefined();
      expect(deleteRow.metadata?.deletedDrawSnapshot?.drawId).toBe(drawId);
      const auditId = deleteRow.auditId;

      // Restore from the snapshot
      const restoreResult = await request(app.getHttpServer())
        .post('/audit/restore-draw')
        .set('Authorization', `Bearer ${token}`)
        .send({ auditId })
        .expect(200);
      expect(restoreResult.body.success).toBe(true);
      expect(restoreResult.body.drawId).toBe(drawId);
      expect(restoreResult.body.eventId).toBe(eventId);

      // The draw should be back on the tournament record
      const fetchResult = await request(app.getHttpServer())
        .post('/factory/fetch')
        .set('Authorization', `Bearer ${token}`)
        .send({ tournamentIds: [restoreTournamentId] })
        .expect(200);
      const restoredDraws =
        fetchResult.body.tournamentRecords?.[restoreTournamentId]?.events?.find((e: any) => e.eventId === eventId)
          ?.drawDefinitions ?? [];
      expect(restoredDraws.some((d: any) => d.drawId === drawId)).toBe(true);

      // A RESTORE_DRAW audit row should exist
      const trail = await request(app.getHttpServer())
        .post('/audit/tournament')
        .set('Authorization', `Bearer ${token}`)
        .send({ tournamentId: restoreTournamentId })
        .expect(200);
      const restoreRow = trail.body.auditRows.find(
        (r: any) => r.actionType === 'RESTORE_DRAW' && r.metadata?.restoredFromAuditId === auditId,
      );
      expect(restoreRow).toBeDefined();
      expect(restoreRow.metadata.drawId).toBe(drawId);

      // Idempotency: a second restore call refuses
      const secondRestore = await request(app.getHttpServer())
        .post('/audit/restore-draw')
        .set('Authorization', `Bearer ${token}`)
        .send({ auditId })
        .expect(200);
      expect(secondRestore.body.error).toBe('ALREADY_RESTORED');
    } finally {
      // Clean up the throwaway tournament
      await request(app.getHttpServer())
        .post('/factory/remove')
        .set('Authorization', `Bearer ${token}`)
        .send({ tournamentId: restoreTournamentId, providerId })
        .catch(() => undefined);
    }
  });

  it('rejects /audit/restore-draw for missing / non-DELETE_DRAW audit rows', async () => {
    const result = await request(app.getHttpServer())
      .post('/audit/restore-draw')
      .set('Authorization', `Bearer ${token}`)
      .send({ auditId: 'nonexistent-audit-id' })
      .expect(200);
    expect(result.body.error).toBe('AUDIT_ROW_NOT_FOUND');
  });

  it('records audit rows for tournament deletion', async () => {
    // Delete the tournament
    await request(app.getHttpServer())
      .post('/factory/remove')
      .set('Authorization', `Bearer ${token}`)
      .send({ tournamentId: AUDIT_TOURNAMENT_ID, providerId })
      .expect(200);

    // Wait for async audit write
    await new Promise((r) => setTimeout(r, 200));

    // Query deleted tournaments — should find the deletion event
    const deletedResult = await request(app.getHttpServer())
      .post('/audit/deleted')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    expect(deletedResult.body.success).toBe(true);
    const deletionRow = deletedResult.body.auditRows.find((r: any) => r.tournamentId === AUDIT_TOURNAMENT_ID);
    expect(deletionRow).toBeDefined();
    expect(deletionRow.actionType).toBe('DELETE_TOURNAMENT');
    expect(deletionRow.metadata?.tournamentName).toBeDefined();

    // The original mutation audit rows should still exist
    // (audit rows survive tournament deletion — no FK cascade)
    const trailResult = await request(app.getHttpServer())
      .post('/audit/tournament')
      .set('Authorization', `Bearer ${token}`)
      .send({ tournamentId: AUDIT_TOURNAMENT_ID })
      .expect(200);

    expect(trailResult.body.success).toBe(true);
    const allRows = trailResult.body.auditRows;
    const actionTypes = allRows.map((r: any) => r.actionType);
    expect(actionTypes).toContain('MUTATION');
    expect(actionTypes).toContain('DELETE_TOURNAMENT');
  });

  it('rejects audit queries from unauthenticated clients', async () => {
    await request(app.getHttpServer())
      .post('/audit/tournament')
      .send({ tournamentId: AUDIT_TOURNAMENT_ID })
      .expect(401);

    await request(app.getHttpServer()).post('/audit/deleted').send({}).expect(401);
  });
});
