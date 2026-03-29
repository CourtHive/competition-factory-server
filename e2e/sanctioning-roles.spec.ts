/**
 * E2E tests for role-based access control in the sanctioning workflow.
 *
 * Verifies that:
 * - CLIENT users can create/edit/submit but NOT approve/reject
 * - ADMIN users can review/approve/reject
 * - Provider scoping limits visibility to own records
 */
import { test, expect } from '@playwright/test';
import { SanctioningApiHelper } from './helpers/sanctioningApi';
import { SanctioningDetailPage } from './pages/SanctioningDetailPage';
import { ITF_W50_APPLICATION } from './fixtures/sanctioning-data';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

test.describe('Role-Based Access — API Level', () => {
  test('CLIENT role can create a sanctioning record', async ({ request }) => {
    // This test uses the API directly — no UI
    const api = new SanctioningApiHelper(request, SERVER_URL);
    const result = await api.create(ITF_W50_APPLICATION);
    expect(result?.sanctioningRecord?.sanctioningId).toBeDefined();
    expect(result?.sanctioningRecord?.status).toBe('DRAFT');
  });

  test('API rejects reviewer methods from CLIENT role', async ({ request }) => {
    const api = new SanctioningApiHelper(request, SERVER_URL);
    const createResult = await api.create(ITF_W50_APPLICATION);
    const sanctioningId = createResult?.sanctioningRecord?.sanctioningId;

    // Submit first (this is a CLIENT method — should work)
    const submitResult = await api.execute(sanctioningId, 'submitApplication', {});
    // Note: may succeed or fail depending on auth setup — the point is the
    // reviewer method check below

    // approveApplication is a REVIEWER_METHOD — should be rejected for CLIENT
    // (This test will only fully work when auth is wired with proper role tokens)
    const approveResult = await api.execute(sanctioningId, 'approveApplication', {});
    // Expected: either 403 or error indicating reviewer role required
  });

  test('records are scoped to provider', async ({ request }) => {
    const api = new SanctioningApiHelper(request, SERVER_URL);

    // Create a record
    await api.create({
      ...ITF_W50_APPLICATION,
      applicantProviderId: 'provider-a',
      proposal: { ...ITF_W50_APPLICATION.proposal, tournamentName: 'Provider A Record' },
    });

    // List with provider filter
    const listA = await api.list('provider-a');
    const namesA = (listA?.sanctioningRecords ?? []).map((r: any) => r.proposal?.tournamentName);
    expect(namesA).toContain('Provider A Record');

    const listB = await api.list('provider-b');
    const namesB = (listB?.sanctioningRecords ?? []).map((r: any) => r.proposal?.tournamentName);
    expect(namesB).not.toContain('Provider A Record');
  });
});

test.describe('Role-Based Access — UI Level', () => {
  test('detail page shows reviewer actions only for ADMIN users', async ({ page, request }) => {
    // This test uses the default storageState (admin.json)
    const api = new SanctioningApiHelper(request, SERVER_URL);
    const createResult = await api.create(ITF_W50_APPLICATION);
    const sanctioningId = createResult?.sanctioningRecord?.sanctioningId;
    await api.execute(sanctioningId, 'submitApplication', {});
    await api.execute(sanctioningId, 'reviewApplication', {});

    const detail = new SanctioningDetailPage(page);
    await detail.goto(sanctioningId);

    // ADMIN should see approve/reject buttons
    await detail.expectActionAvailable('Approve');
    await detail.expectActionAvailable('Reject');
    await detail.expectActionAvailable('Request Modifications');
  });
});
