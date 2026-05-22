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
import { io, Socket } from 'socket.io-client';
import request from 'supertest';

import { saveAndCommit } from 'src/tests/helpers/saveAndCommit';
import { TEST_EMAIL, TEST_PASSWORD } from 'src/common/constants/test';

const AUDIT_TOURNAMENT_ID = `audit-e2e-${Date.now()}`;
const AUDIT_PROVIDER_ABBR = `AUDITE2E${Date.now()}`;

const e2eEnabled = process.env.STORAGE_PROVIDER === 'postgres';
const d = e2eEnabled ? describe : describe.skip;

d('Audit Trail E2E', () => {
  let app: INestApplication;
  let baseUrl: string;
  let token: string;
  let providerId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    // The socket-path tests need a live HTTP listener for socket.io to attach to.
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;

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
          await calendarStorage.setCalendar(AUDIT_PROVIDER_ABBR, { provider: {}, tournaments: [] });
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

  // ── TMX socket path coverage ──
  //
  // The REST `/factory` path above is the only path the original Phase A
  // wiring exercised. The TMX WebSocket gateway is the path ~100% of
  // production mutations actually traverse — and was bypassing the
  // AuditService entirely until the 2026-05-22 fix that injected it into
  // TmxGateway. These three specs lock down that newly-wired path.

  function connectTmxClient(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}/tmx`, {
        auth: { token },
        extraHeaders: { authorization: `Bearer ${token}` },
        transports: ['websocket', 'polling'],
        reconnection: false,
      });
      const timeout = setTimeout(() => reject(new Error('Socket connection timeout')), 10000);
      socket.on('connect', () => {
        clearTimeout(timeout);
        resolve(socket);
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  function sendExecutionQueue(
    socket: Socket,
    payload: any,
  ): Promise<{ ackId: string; success?: boolean; error?: any }> {
    const ackId = payload.ackId ?? tools.UUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('executionQueue ack timeout')), 10000);
      socket.on('ack', (ack: any) => {
        if (ack?.ackId !== ackId) return;
        clearTimeout(timer);
        resolve(ack);
      });
      socket.emit('executionQueue', { type: 'executionQueue', payload: { ...payload, ackId } });
    });
  }

  it('records audit rows for mutations via TMX socket gateway', async () => {
    const tmxClient = await connectTmxClient();
    try {
      const ack = await sendExecutionQueue(tmxClient, {
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
      // 2025-06-02 startDate that uniquely identifies this socket-path
      // mutation (REST test above used 2025-06-01).
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
    } finally {
      tmxClient.close();
    }
  });

  it('records rejected mutations with errorCode + full method params', async () => {
    const tmxClient = await connectTmxClient();
    try {
      // Deliberately target a courtId that doesn't exist — the exact
      // failure mode of the 2026-05-21 p.sychrovsky incident.
      const bogusCourtId = `bogus-court-${tools.UUID()}`;
      const ack = await sendExecutionQueue(tmxClient, {
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
    } finally {
      tmxClient.close();
    }
  });

  it('stamps ackId from TMX payload into audit metadata', async () => {
    const tmxClient = await connectTmxClient();
    try {
      const ackId = `audit-corr-${tools.UUID()}`;
      const ack = await sendExecutionQueue(tmxClient, {
        ackId,
        methods: [
          {
            method: 'setTournamentDates',
            params: { startDate: '2025-06-03', endDate: '2025-06-09', tournamentId: AUDIT_TOURNAMENT_ID },
          },
        ],
        tournamentIds: [AUDIT_TOURNAMENT_ID],
      });
      expect(ack.success).toBe(true);
      expect(ack.ackId).toBe(ackId);

      await new Promise((r) => setTimeout(r, 250));

      const auditResult = await request(app.getHttpServer())
        .post('/audit/tournament')
        .set('Authorization', `Bearer ${token}`)
        .send({ tournamentId: AUDIT_TOURNAMENT_ID })
        .expect(200);

      const correlatedRow = auditResult.body.auditRows.find(
        (r: any) => r.metadata?.ackId === ackId,
      );
      expect(correlatedRow).toBeDefined();
      expect(correlatedRow.status).toBe('applied');
    } finally {
      tmxClient.close();
    }
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
    const deletionRow = deletedResult.body.auditRows.find(
      (r: any) => r.tournamentId === AUDIT_TOURNAMENT_ID,
    );
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

    await request(app.getHttpServer())
      .post('/audit/deleted')
      .send({})
      .expect(401);
  });
});
