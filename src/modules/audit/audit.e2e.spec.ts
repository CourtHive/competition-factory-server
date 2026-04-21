/**
 * Audit trail end-to-end test.
 *
 * Boots the full AppModule against the live Postgres database.
 * Uses the super-admin test user (axel@castle.com) to:
 *   1. Create a test provider
 *   2. Save a tournament under that provider
 *   3. Mutate it via executionQueue
 *   4. Verify audit rows are written and queryable
 *   5. Delete the tournament
 *   6. Verify deletion audit row survives
 *   7. Clean up the test provider
 */
import { AppModule } from 'src/modules/app/app.module';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mocksEngine } from 'tods-competition-factory';
import request from 'supertest';

import { saveAndCommit } from 'src/tests/helpers/saveAndCommit';
import { TEST_EMAIL, TEST_PASSWORD } from 'src/common/constants/test';

const AUDIT_TOURNAMENT_ID = `audit-e2e-${Date.now()}`;
const AUDIT_PROVIDER_ABBR = `AUDITE2E${Date.now()}`;

describe('Audit Trail E2E', () => {
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
    await app.close();
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
